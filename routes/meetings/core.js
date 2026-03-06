const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { z } = require("zod");
const { uploadFile, getFile } = require("../../services/s3");
const { sendMessage } = require("../../services/sqs");
const logger = require("../../services/logger");
const store = require("../../services/meeting-store");
const { mergeAudioFiles } = require("../../services/ffmpeg");
const { warmUpGPU } = require("../../services/gpu-autoscale");
const {
  upload,
  uploadMultiple,
  sanitizeFilename,
  getMeetingById,
} = require("./helpers");

const uploadSchema = z.object({
  title: z.string().max(200).optional(),
  meetingType: z.enum(["general", "tech", "weekly", "customer"]).optional(),
  recipientEmails: z.string().optional(),
});

const meetingUpdateSchema = z.object({
  title: z.string().max(200).optional(),
  meetingType: z.enum(["general", "tech", "weekly", "customer"]).optional(),
  speakerMap: z.record(z.string()).optional(),
  status: z.string().optional(),
  content: z.any().optional(),
});

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
      // Validate request body with zod
      const parseResult = meetingUpdateSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({
          error: {
            code: "VALIDATION_ERROR",
            message: parseResult.error.message,
            fields: parseResult.error.issues.map(e => ({ field: e.path.join('.'), message: e.message }))
          }
        });
      }

      const item = await getMeetingById(req.params.id);
      if (!item) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Not found" } });

      const { status, content, title, meetingType, speakerMap } = parseResult.data;
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
      if (speakerMap !== undefined) {
        expressions.push("speakerMap = :sm");
        values[":sm"] = speakerMap;
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

      // Validate request body with zod
      const parseResult = uploadSchema.safeParse(req.body);
      if (!parseResult.success) {
        // Clean up temp file
        if (req.file && fs.existsSync(req.file.path)) {
          fs.unlinkSync(req.file.path);
        }
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: parseResult.error.message } });
      }

      const meetingId = crypto.randomUUID();
      const filename = sanitizeFilename(req.file.originalname);
      const s3Key = `inbox/${meetingId}/${filename}`;

      // Upload to S3
      const fileBuffer = await fs.promises.readFile(req.file.path);
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
        status: "uploaded", // 新状态：等待用户确认
        s3Key,
        filename,
        meetingType,
        ...(recipientEmails.length ? { recipientEmails } : {}),
      };
      await store.createMeetingFromUpload(item);

      // 异步预热 GPU，不阻塞响应
      warmUpGPU().catch(err => logger.warn("meetings-route", "gpu-warmup-failed", { error: err.message }));

      // 不再自动发送转录消息，等待前端确认

      res.status(201).json({ meetingId, status: "uploaded", title: item.title, meetingType });
    } catch (err) {
      // Clean up temp file on error
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      next(err);
    }
  });

  // Upload multiple files, merge them, then start transcription
  router.post("/upload-multiple", (req, res, next) => {
    uploadMultiple(req, res, (err) => {
      if (err) {
        // Clean up temp files if they exist
        if (req.files && Array.isArray(req.files)) {
          for (const file of req.files) {
            if (fs.existsSync(file.path)) {
              try {
                fs.unlinkSync(file.path);
              } catch (cleanupErr) {
                logger.warn("meetings-route", "cleanup-temp-file-failed", { error: cleanupErr.message });
              }
            }
          }
        }
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(413).json({ error: { code: "FILE_TOO_LARGE", message: "文件大小超过 2GB 限制" } });
        }
        if (err.code === "LIMIT_FILE_COUNT") {
          return res.status(400).json({ error: { code: "TOO_MANY_FILES", message: "文件数量超过 10 个限制" } });
        }
        return res.status(400).json({ error: { code: "UPLOAD_ERROR", message: err.message } });
      }
      next();
    });
  }, async (req, res, next) => {
    const tempFiles = [];
    let mergedFilePath;

    try {
      if (!req.files || !Array.isArray(req.files) || req.files.length === 0) {
        return res.status(400).json({ error: { code: "NO_FILES", message: "No files provided" } });
      }

      // 收集所有临时文件路径，用于清理
      tempFiles.push(...req.files.map(f => f.path));

      // Validate request body with zod
      const parseResult = uploadSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: parseResult.error.message } });
      }

      logger.info("meetings-route", "upload-multiple-start", {
        fileCount: req.files.length,
        totalSize: req.files.reduce((sum, f) => sum + f.size, 0),
      });

      // 合并音频文件
      const meetingId = crypto.randomUUID();
      mergedFilePath = path.join("/tmp", `merged-${meetingId}.ogg`);
      const inputFiles = req.files.map(f => f.path);

      await mergeAudioFiles(inputFiles, mergedFilePath);
      tempFiles.push(mergedFilePath);

      // 读取合并后的文件
      const fileBuffer = await fs.promises.readFile(mergedFilePath);

      // 使用第一个文件的原始名称（去掉扩展名）+ ".ogg"
      const originalBasename = path.basename(req.files[0].originalname, path.extname(req.files[0].originalname));
      const filename = sanitizeFilename(`${originalBasename}-merged.ogg`);
      const s3Key = `inbox/${meetingId}/${filename}`;

      // Upload to S3
      await uploadFile(s3Key, fileBuffer, "audio/ogg");

      logger.info("meetings-route", "upload-multiple-s3-success", { meetingId, s3Key });

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
        status: "uploaded",
        s3Key,
        filename,
        meetingType,
        ...(recipientEmails.length ? { recipientEmails } : {}),
      };
      await store.createMeetingFromUpload(item);

      // 异步预热 GPU，不阻塞响应
      warmUpGPU().catch(err => logger.warn("meetings-route", "gpu-warmup-failed", { error: err.message }));

      logger.info("meetings-route", "upload-multiple-complete", { meetingId });

      res.status(201).json({ meetingId, status: "uploaded", title: item.title, meetingType });
    } catch (err) {
      logger.error("meetings-route", "upload-multiple-failed", { error: err.message });
      next(err);
    } finally {
      // 清理所有临时文件
      for (const filePath of tempFiles) {
        if (filePath && fs.existsSync(filePath)) {
          try {
            await fs.promises.unlink(filePath);
          } catch (cleanupErr) {
            logger.warn("meetings-route", "cleanup-temp-file-failed", { file: filePath, error: cleanupErr.message });
          }
        }
      }
    }
  });

  // Start transcription after user confirmation
  router.post("/:id/start-transcription", async (req, res, next) => {
    try {
      const item = await getMeetingById(req.params.id);
      if (!item) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Not found" } });
      if (item.status !== "uploaded") {
        return res.status(400).json({ error: { code: "INVALID_STATUS", message: "会议状态不是 uploaded，无法开始转录" } });
      }

      // Update status to pending
      const updateExpr = "#s = :s, updatedAt = :u";
      const names = { "#s": "status" };
      const values = { ":s": "pending", ":u": new Date().toISOString() };
      await store.updateMeeting(req.params.id, item.createdAt, [updateExpr], names, values);

      // Send message to transcription queue
      await sendMessage(process.env.SQS_TRANSCRIPTION_QUEUE, {
        meetingId: item.meetingId,
        s3Key: item.s3Key,
        filename: item.filename,
        meetingType: item.meetingType || "general",
        createdAt: item.createdAt,
      });

      res.json({ success: true, status: "pending" });
    } catch (err) {
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
