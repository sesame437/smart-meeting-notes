const crypto = require("crypto");
const fs = require("fs");
const { uploadFile, getFile } = require("../../services/s3");
const { sendMessage } = require("../../services/sqs");
const logger = require("../../services/logger");
const store = require("../../services/meeting-store");
const {
  upload,
  sanitizeFilename,
  getMeetingById,
} = require("./helpers");

function register(router) {
  // List meetings - deduplicate by meetingId, prefer item with title, then latest createdAt
  router.get("/", async (_req, res, next) => {
    try {
      const all = await store.listMeetings();
      // Group by meetingId, prefer item with title, then latest createdAt
      const map = new Map();
      for (const item of all) {
        const existing = map.get(item.meetingId);
        if (!existing) {
          map.set(item.meetingId, item);
        } else {
          const existingHasTitle = !!(existing.title);
          const itemHasTitle = !!(item.title);
          if (itemHasTitle && !existingHasTitle) {
            map.set(item.meetingId, item); // prefer titled item
          } else if (existingHasTitle === itemHasTitle && item.createdAt > existing.createdAt) {
            map.set(item.meetingId, item); // same title status → take newer
          }
        }
      }
      // Sort by createdAt descending
      const deduped = Array.from(map.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      res.json(deduped);
    } catch (err) {
      next(err);
    }
  });

  // Create meeting
  router.post("/", async (req, res, next) => {
    try {
      const { title, meetingType, recipientEmails } = req.body;
      const item = {
        meetingId: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        status: "created",
      };
      if (title !== undefined) item.title = title;
      if (meetingType !== undefined) item.meetingType = meetingType;
      if (recipientEmails !== undefined) item.recipientEmails = recipientEmails;
      await store.createMeeting(item);
      res.status(201).json(item);
    } catch (err) {
      next(err);
    }
  });

  // Get single meeting
  router.get("/:id", async (req, res, next) => {
    try {
      const item = await getMeetingById(req.params.id);
      if (!item) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Not found" } });

      // If report exists in S3 but not yet in DynamoDB content field, load it
      if (!item.content && item.reportKey) {
        try {
          const stream = await getFile(item.reportKey);
          const chunks = [];
          for await (const chunk of stream) {
            chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
          }
          const text = Buffer.concat(chunks).toString("utf-8");
          item.content = JSON.parse(text);
        } catch (_e) {
          // report not ready yet, return item without content
        }
      }

      res.json(item);
    } catch (err) {
      next(err);
    }
  });

  // Update meeting
  router.put("/:id", async (req, res, next) => {
    try {
      const item = await getMeetingById(req.params.id);
      if (!item) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Not found" } });

      const { status, content, title, meetingType } = req.body;
      const expressions = [];
      const names = {};
      const values = {};

      if (status !== undefined) {
        expressions.push("#s = :s");
        names["#s"] = "status";
        values[":s"] = status;
      }
      if (content !== undefined) {
        expressions.push("#c = :c");
        names["#c"] = "content";
        values[":c"] = content;
      }
      if (title !== undefined) {
        expressions.push("#t = :t");
        names["#t"] = "title";
        values[":t"] = title;
      }
      if (meetingType !== undefined) {
        expressions.push("meetingType = :mt");
        values[":mt"] = meetingType;
      }

      expressions.push("updatedAt = :u");
      values[":u"] = new Date().toISOString();

      const updatedItem = await store.updateMeeting(req.params.id, item.createdAt, expressions, names, values);
      res.json(updatedItem);
    } catch (err) {
      next(err);
    }
  });

  // Delete meeting
  router.delete("/:id", async (req, res, next) => {
    try {
      const item = await getMeetingById(req.params.id);
      if (!item) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Not found" } });

      await store.deleteMeeting(req.params.id, item.createdAt);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  // Upload file and start transcription
  router.post("/upload", (req, res, next) => {
    upload.single("file")(req, res, (err) => {
      if (err) {
        // Clean up temp file if it exists
        if (req.file && fs.existsSync(req.file.path)) {
          fs.unlinkSync(req.file.path);
        }
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(413).json({ error: { code: "FILE_TOO_LARGE", message: "文件大小超过 2GB 限制" } });
        }
        return res.status(400).json({ error: { code: "UPLOAD_ERROR", message: err.message } });
      }
      next();
    });
  }, async (req, res, next) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: { code: "NO_FILE", message: "No file provided" } });
      }

      const meetingId = crypto.randomUUID();
      const filename = sanitizeFilename(req.file.originalname);
      const s3Key = `inbox/${meetingId}/${filename}`;

      // Upload to S3
      const fileBuffer = fs.readFileSync(req.file.path);
      await uploadFile(s3Key, fileBuffer, req.file.mimetype);

      // Clean up temp file
      fs.unlinkSync(req.file.path);

      // Parse and validate recipient emails
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      let recipientEmails = [];
      if (req.body.recipientEmails) {
        recipientEmails = req.body.recipientEmails
          .split(",")
          .map(e => e.trim())
          .filter(e => emailRegex.test(e));
      }

      // Create meeting record in DynamoDB
      const meetingType = req.body.meetingType || "general";
      const item = {
        meetingId,
        title: req.body.title || filename.replace(/\.[^.]+$/, ""),
        createdAt: new Date().toISOString(),
        status: "pending",
        s3Key,
        filename,
        meetingType,
        ...(recipientEmails.length ? { recipientEmails } : {}),
      };
      await store.createMeetingFromUpload(item);

      // Send message to transcription queue
      await sendMessage(process.env.SQS_TRANSCRIPTION_QUEUE, {
        meetingId,
        s3Key,
        filename,
        meetingType,
      });

      res.status(201).json({ meetingId, status: "pending" });
    } catch (err) {
      // Clean up temp file on error
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      next(err);
    }
  });

  // Retry failed meeting
  router.post("/:id/retry", async (req, res, next) => {
    try {
      const item = await getMeetingById(req.params.id);
      if (!item) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Not found" } });
      if (item.status !== "failed") {
        return res.status(400).json({ error: { code: "INVALID_STATUS", message: "Only failed meetings can be retried" } });
      }

      // Reset status and send back to transcription queue
      // Use ConditionExpression to prevent race condition: only update if still failed
      const updateExpr = "SET #s = :s, stage = :stage, updatedAt = :u REMOVE errorMessage";
      try {
        await store.retryMeeting(req.params.id, item.createdAt, updateExpr);
      } catch (condErr) {
        if (condErr.name === 'ConditionalCheckFailedException') {
          return res.status(409).json({ error: { code: "INVALID_STATUS", message: "会议当前不是失败状态，无法重试" } });
        }
        throw condErr;
      }

      try {
        await sendMessage(process.env.SQS_TRANSCRIPTION_QUEUE, {
          meetingId: item.meetingId,
          s3Key: item.s3Key,
          filename: item.filename,
          meetingType: item.meetingType || "general",
          createdAt: item.createdAt,
        });
      } catch (sqsErr) {
        // Rollback: revert status to failed since SQS enqueue failed
        try {
          await store.rollbackRetry(req.params.id, item.createdAt, "SQS 入队失败: " + sqsErr.message);
        } catch (rollbackErr) {
          logger.error("meetings-route", "retry-rollback-failed", {}, rollbackErr);
        }
        return res.status(500).json({ error: { code: "QUEUE_ERROR", message: "重试入队失败，请稍后再试" } });
      }

      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  });
}

module.exports = register;
