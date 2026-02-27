const { Router } = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const { docClient } = require("../db/dynamodb");
const {
  ScanCommand,
  QueryCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
} = require("@aws-sdk/lib-dynamodb");
const { uploadFile, getFile } = require("../services/s3");
const { sendMessage } = require("../services/sqs");
const { invokeModel } = require("../services/bedrock");

const router = Router();
const TABLE = process.env.DYNAMODB_TABLE;
const GLOSSARY_TABLE = process.env.GLOSSARY_TABLE || "meeting-minutes-glossary";
const HAIKU_MODEL_ID = process.env.HAIKU_MODEL_ID || "us.anthropic.claude-haiku-4-5-20251001-v1:0";

// Param validation middleware: id must be non-empty, max 100 chars
function validateIdParam(req, res, next) {
  const id = req.params.id;
  if (!id || typeof id !== "string" || id.length > 100) {
    return res.status(400).json({ error: "Invalid id parameter" });
  }
  next();
}
router.param("id", validateIdParam);
const upload = multer({
  dest: "/tmp",
  limits: {
    fileSize: 2 * 1024 * 1024 * 1024, // 2GB 上限
    files: 1,
  },
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      "audio/mpeg", "audio/wav", "audio/mp4", "audio/x-m4a",
      "audio/ogg", "audio/x-ogg", "video/ogg", "application/x-ogg", "audio/vorbis",
      "audio/webm", "video/mp4", "video/webm",
      "video/quicktime", "application/octet-stream",
    ];
    const allowedExts = [".mp3", ".wav", ".mp4", ".m4a", ".ogg", ".webm", ".mov"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedMimes.includes(file.mimetype) || allowedExts.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`不支持的文件格式: ${file.originalname}`), false);
    }
  },
});

function sanitizeFilename(name) {
  return name
    .replace(/[^\w\-_.]/g, "_")  // 只保留安全字符
    .replace(/\.{2,}/g, "_")      // 去掉 ../
    .substring(0, 200);
}

async function getMeetingById(id) {
  const { Items } = await docClient.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: "meetingId = :id",
    ExpressionAttributeValues: {
      ":id": id,
    },
    Limit: 1,
  }));
  return Items?.[0] || null;
}

// List meetings - deduplicate by meetingId, prefer item with title, then latest createdAt
router.get("/", async (_req, res, next) => {
  try {
    const { Items } = await docClient.send(new ScanCommand({ TableName: TABLE }));
    const all = Items || [];
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
    await docClient.send(new PutCommand({ TableName: TABLE, Item: item }));
    res.status(201).json(item);
  } catch (err) {
    next(err);
  }
});

// Get single meeting
router.get("/:id", async (req, res, next) => {
  try {
    const item = await getMeetingById(req.params.id);
    if (!item) return res.status(404).json({ error: "Not found" });

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
      } catch (e) {
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
    if (!item) return res.status(404).json({ error: "Not found" });

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

    const { Attributes } = await docClient.send(new UpdateCommand({
      TableName: TABLE,
      Key: { meetingId: req.params.id, createdAt: item.createdAt },
      UpdateExpression: `SET ${expressions.join(", ")}`,
      ExpressionAttributeNames: Object.keys(names).length ? names : undefined,
      ExpressionAttributeValues: values,
      ReturnValues: "ALL_NEW",
    }));
    res.json(Attributes);
  } catch (err) {
    next(err);
  }
});

// Delete meeting
router.delete("/:id", async (req, res, next) => {
  try {
    const item = await getMeetingById(req.params.id);
    if (!item) return res.status(404).json({ error: "Not found" });

    await docClient.send(new DeleteCommand({
      TableName: TABLE,
      Key: { meetingId: req.params.id, createdAt: item.createdAt },
    }));
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
        return res.status(413).json({ error: "文件大小超过 2GB 限制" });
      }
      return res.status(400).json({ error: err.message });
    }
    next();
  });
}, async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file provided" });
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
    await docClient.send(new PutCommand({ TableName: TABLE, Item: item }));

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
    if (!item) return res.status(404).json({ error: "Not found" });
    if (item.status !== "failed") {
      return res.status(400).json({ error: "Only failed meetings can be retried" });
    }

    // Reset status and send back to transcription queue
    // Use ConditionExpression to prevent race condition: only update if still failed
    const updateExpr = "SET #s = :s, stage = :stage, updatedAt = :u REMOVE errorMessage";
    try {
      await docClient.send(new UpdateCommand({
        TableName: TABLE,
        Key: { meetingId: req.params.id, createdAt: item.createdAt },
        UpdateExpression: updateExpr,
        ConditionExpression: "#s = :failed",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: {
          ":s": "processing",
          ":stage": "transcribing",
          ":u": new Date().toISOString(),
          ":failed": "failed",
        },
      }));
    } catch (condErr) {
      if (condErr.name === 'ConditionalCheckFailedException') {
        return res.status(409).json({ error: '会议当前不是失败状态，无法重试' });
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
        await docClient.send(new UpdateCommand({
          TableName: TABLE,
          Key: { meetingId: req.params.id, createdAt: item.createdAt },
          UpdateExpression: "SET #s = :s, stage = :stage, errorMessage = :em, updatedAt = :u",
          ExpressionAttributeNames: { "#s": "status" },
          ExpressionAttributeValues: {
            ":s": "failed",
            ":stage": "failed",
            ":em": "SQS 入队失败: " + sqsErr.message,
            ":u": new Date().toISOString(),
          },
        }));
      } catch (rollbackErr) {
        console.error('[retry] Rollback failed:', rollbackErr.message);
      }
      return res.status(500).json({ error: '重试入队失败，请稍后再试' });
    }

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// Merge multiple meetings into a combined report
router.post("/merge", async (req, res, next) => {
  try {
    const { meetingIds, customPrompt } = req.body;

    // Validate meetingIds
    if (!Array.isArray(meetingIds) || meetingIds.length < 2) {
      return res.status(400).json({ error: "meetingIds must contain at least 2 items" });
    }
    if (meetingIds.length > 10) {
      return res.status(400).json({ error: "meetingIds cannot exceed 10 items" });
    }

    // Fetch all meeting records
    const meetings = [];
    for (const id of meetingIds) {
      const item = await getMeetingById(id);
      if (!item) return res.status(404).json({ error: `Meeting not found: ${id}` });
      meetings.push(item);
    }

    // Read report content from DynamoDB or S3 for each meeting
    const mergedParts = [];
    const skipped = [];
    const parentIds = [];

    for (const m of meetings) {
      let content = m.content;

      // If no content in DynamoDB but reportKey exists, load from S3
      if (!content && m.reportKey) {
        try {
          const stream = await getFile(m.reportKey);
          const chunks = [];
          for await (const chunk of stream) {
            chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
          }
          const text = Buffer.concat(chunks).toString("utf-8");
          content = JSON.parse(text);
        } catch (err) {
          console.warn(`[merge] Failed to read report for ${m.meetingId}:`, err.message);
        }
      }

      if (content) {
        const date = m.createdAt ? new Date(m.createdAt).toLocaleDateString("zh-CN") : "";
        const type = m.meetingType || "general";
        mergedParts.push(`=== 会议：${m.title || m.meetingId}（${type}，${date}）===\n${JSON.stringify(content, null, 2)}`);
        parentIds.push(m.meetingId);
      } else {
        skipped.push({ meetingId: m.meetingId, reason: "无报告内容" });
      }
    }

    if (mergedParts.length === 0) {
      return res.status(400).json({ error: "所有会议均无报告内容" });
    }

    const mergedText = mergedParts.join("\n\n");

    // Fetch glossary terms
    let glossaryTerms = [];
    try {
      const { Items: glossaryItems } = await docClient.send(new ScanCommand({
        TableName: GLOSSARY_TABLE,
        ProjectionExpression: "termId",
      }));
      glossaryTerms = (glossaryItems || []).map(i => i.termId).filter(Boolean);
    } catch (err) {
      console.warn("[merge] Failed to fetch glossary:", err.message);
    }

    // Call Bedrock
    const modelId = process.env.BEDROCK_MODEL_ID || undefined;
    const responseText = await invokeModel(mergedText, "merged", glossaryTerms, modelId, null, customPrompt || null);

    // Parse report JSON
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(500).json({ error: "Failed to parse report from Bedrock" });
    }
    const report = JSON.parse(jsonMatch[0]);

    // Create merged meeting record
    const meetingId = crypto.randomUUID();
    const now = new Date().toISOString();

    // Upload report to S3
    const reportKey = `reports/${meetingId}/report.json`;
    const fullReportKey = await uploadFile(reportKey, JSON.stringify(report, null, 2), "application/json");

    // Save to DynamoDB
    await docClient.send(new PutCommand({
      TableName: TABLE,
      Item: {
        meetingId,
        meetingType: "merged",
        title: `合并报告 — ${new Date().toLocaleDateString("zh-CN")}`,
        parentIds,
        customPrompt: customPrompt || "",
        status: "reported",
        stage: "exporting",
        content: report,
        reportKey: fullReportKey,
        createdAt: now,
      },
    }));

    // Note: email is sent manually via POST /:id/send-email
    res.status(201).json({ meetingId, report, skipped });
  } catch (err) {
    next(err);
  }
});

// Shared validation for speakerMap input
function validateSpeakerMap(speakerMap) {
  if (!speakerMap || typeof speakerMap !== "object" || Array.isArray(speakerMap)) {
    return "speakerMap must be an object";
  }
  if (Object.keys(speakerMap).length === 0) {
    return "speakerMap cannot be empty";
  }
  for (const [speakerId, speakerName] of Object.entries(speakerMap)) {
    if (!speakerId || typeof speakerId !== "string" || speakerId.length > 200) {
      return "speakerMap key must be a non-empty string";
    }
    if (typeof speakerName !== "string") {
      return "speakerMap values must be strings";
    }
    if (speakerName.length > 100) {
      return "speakerMap value must be at most 100 characters";
    }
  }
  return null;
}

// Read transcript parts from S3 for a meeting item
async function readTranscriptParts(item) {
  const transcriptParts = [];

  if (item.transcribeKey) {
    try {
      const stream = await getFile(item.transcribeKey);
      const chunks = [];
      for await (const chunk of stream) {
        chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
      }
      const raw = Buffer.concat(chunks).toString("utf-8");
      try {
        const data = JSON.parse(raw);
        const text = data?.results?.transcripts?.[0]?.transcript;
        if (text) transcriptParts.push(`[AWS Transcribe 转录]\n${text}`);
        else transcriptParts.push(raw);
      } catch { transcriptParts.push(raw); }
    } catch (err) {
      console.warn("[transcript] Failed to read transcribeKey:", err.message);
    }
  }

  if (item.whisperKey) {
    try {
      const stream = await getFile(item.whisperKey);
      const chunks = [];
      for await (const chunk of stream) {
        chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
      }
      const text = Buffer.concat(chunks).toString("utf-8");
      transcriptParts.push(`[Whisper 转录]\n${text}`);
    } catch (err) {
      console.warn("[transcript] Failed to read whisperKey:", err.message);
    }
  }

  if (item.funasrKey) {
    try {
      const stream = await getFile(item.funasrKey);
      const chunks = [];
      for await (const chunk of stream) {
        chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
      }
      const raw = Buffer.concat(chunks).toString("utf-8");
      const data = JSON.parse(raw);
      if (data.segments && data.segments.length > 0) {
        const lines = [];
        let currentSpeaker = null;
        let currentText = "";
        for (const seg of data.segments) {
          const spk = seg.speaker || "SPEAKER_0";
          if (spk !== currentSpeaker) {
            if (currentText) lines.push(`[${currentSpeaker}] ${currentText.trim()}`);
            currentSpeaker = spk;
            currentText = seg.text || "";
          } else {
            currentText += seg.text || "";
          }
        }
        if (currentText) lines.push(`[${currentSpeaker}] ${currentText.trim()}`);
        const funasrText = lines.join("\n").slice(0, 60000);
        transcriptParts.push(`[FunASR 转录（含说话人标签）]\n${funasrText}`);
      } else if (data.text) {
        transcriptParts.push(`[FunASR 转录（含说话人标签）]\n${data.text}`);
      }
    } catch (err) {
      console.warn("[transcript] Failed to read funasrKey:", err.message);
    }
  }

  return transcriptParts;
}

// Save speaker names only (no Bedrock regeneration)
router.put("/:id/speaker-names", async (req, res, next) => {
  try {
    const { speakerMap } = req.body;
    const validationError = validateSpeakerMap(speakerMap);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const item = await getMeetingById(req.params.id);
    if (!item) return res.status(404).json({ error: "Not found" });

    await docClient.send(new UpdateCommand({
      TableName: TABLE,
      Key: { meetingId: req.params.id, createdAt: item.createdAt },
      UpdateExpression: "SET speakerMap = :sm, updatedAt = :u",
      ExpressionAttributeValues: {
        ":sm": speakerMap,
        ":u": new Date().toISOString(),
      },
    }));

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// Regenerate report using stored speakerMap
router.post("/:id/regenerate", async (req, res, next) => {
  try {
    const item = await getMeetingById(req.params.id);
    if (!item) return res.status(404).json({ error: "Not found" });

    const speakerMap = item.speakerMap || null;

    const transcriptParts = await readTranscriptParts(item);
    if (transcriptParts.length === 0) {
      return res.status(400).json({ error: "No transcript found for this meeting" });
    }

    const transcriptText = transcriptParts.join("\n\n");
    const meetingType = item.meetingType || "general";

    // Fetch glossary terms
    let glossaryTerms = [];
    try {
      const { Items: glossaryItems } = await docClient.send(new ScanCommand({
        TableName: GLOSSARY_TABLE,
        ProjectionExpression: "termId",
      }));
      glossaryTerms = (glossaryItems || []).map(i => i.termId).filter(Boolean);
    } catch (err) {
      console.warn("[regenerate] Failed to fetch glossary:", err.message);
    }

    const modelId = process.env.BEDROCK_MODEL_ID || undefined;
    const responseText = await invokeModel(transcriptText, meetingType, glossaryTerms, modelId, speakerMap);

    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(500).json({ error: "Failed to parse report from Bedrock" });
    }
    const report = JSON.parse(jsonMatch[0]);

    const reportKey = `reports/${req.params.id}/report.json`;
    const fullReportKey = await uploadFile(reportKey, JSON.stringify(report, null, 2), "application/json");

    await docClient.send(new UpdateCommand({
      TableName: TABLE,
      Key: { meetingId: req.params.id, createdAt: item.createdAt },
      UpdateExpression: "SET content = :c, reportKey = :rk, #s = :s, stage = :stage, updatedAt = :u",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: {
        ":c": report,
        ":rk": fullReportKey,
        ":s": "reported",
        ":stage": "done",
        ":u": new Date().toISOString(),
      },
    }));

    // Note: email is sent manually via POST /:id/send-email
    res.json({ success: true, report });
  } catch (err) {
    next(err);
  }
});

// Legacy: Update speaker map and regenerate report (kept for backwards compatibility)
router.put("/:id/speaker-map", async (req, res, next) => {
  try {
    const { speakerMap } = req.body;
    const validationError = validateSpeakerMap(speakerMap);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const item = await getMeetingById(req.params.id);
    if (!item) return res.status(404).json({ error: "Not found" });

    // Save speakerMap to DynamoDB
    await docClient.send(new UpdateCommand({
      TableName: TABLE,
      Key: { meetingId: req.params.id, createdAt: item.createdAt },
      UpdateExpression: "SET speakerMap = :sm, updatedAt = :u",
      ExpressionAttributeValues: {
        ":sm": speakerMap,
        ":u": new Date().toISOString(),
      },
    }));

    const transcriptParts = await readTranscriptParts(item);
    if (transcriptParts.length === 0) {
      return res.status(400).json({ error: "No transcript found for this meeting" });
    }

    const transcriptText = transcriptParts.join("\n\n");
    const meetingType = item.meetingType || "general";

    let glossaryTerms = [];
    try {
      const { Items: glossaryItems } = await docClient.send(new ScanCommand({
        TableName: GLOSSARY_TABLE,
        ProjectionExpression: "termId",
      }));
      glossaryTerms = (glossaryItems || []).map(i => i.termId).filter(Boolean);
    } catch (err) {
      console.warn("[speaker-map] Failed to fetch glossary:", err.message);
    }

    const modelId = process.env.BEDROCK_MODEL_ID || undefined;
    const responseText = await invokeModel(transcriptText, meetingType, glossaryTerms, modelId, speakerMap);

    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(500).json({ error: "Failed to parse report from Bedrock" });
    }
    const report = JSON.parse(jsonMatch[0]);

    const reportKey = `reports/${req.params.id}/report.json`;
    const fullReportKey = await uploadFile(reportKey, JSON.stringify(report, null, 2), "application/json");

    await docClient.send(new UpdateCommand({
      TableName: TABLE,
      Key: { meetingId: req.params.id, createdAt: item.createdAt },
      UpdateExpression: "SET content = :c, reportKey = :rk, #s = :s, stage = :stage, updatedAt = :u",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: {
        ":c": report,
        ":rk": fullReportKey,
        ":s": "reported",
        ":stage": "done",
        ":u": new Date().toISOString(),
      },
    }));

    // Note: email is sent manually via POST /:id/send-email
    res.json({ success: true, report });
  } catch (err) {
    next(err);
  }
});

// Patch report section (inline editing)
router.patch("/:id/report", async (req, res, next) => {
  try {
    const { section, data } = req.body;
    const validSections = ["summary", "actionItems", "keyDecisions"];
    if (!validSections.includes(section)) {
      return res.status(400).json({ error: "Invalid section. Must be one of: summary, actionItems, keyDecisions" });
    }
    if (data === undefined || data === null) {
      return res.status(400).json({ error: "data is required" });
    }

    const item = await getMeetingById(req.params.id);
    if (!item) return res.status(404).json({ error: "Not found" });
    if (!item.reportKey) return res.status(400).json({ error: "No report exists for this meeting" });

    // Read current report from S3
    const stream = await getFile(item.reportKey);
    const chunks = [];
    for await (const chunk of stream) {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    }
    const report = JSON.parse(Buffer.concat(chunks).toString("utf-8"));

    // Update the corresponding field
    const fieldMap = {
      summary: "summary",
      actionItems: "actions",
      keyDecisions: "decisions",
    };
    // Also check alternative field names from Bedrock output
    const altFieldMap = {
      summary: "executive_summary",
      actionItems: "actions",
      keyDecisions: "key_decisions",
    };
    const primaryField = fieldMap[section];
    const altField = altFieldMap[section];
    if (report[primaryField] !== undefined) {
      report[primaryField] = data;
    } else if (report[altField] !== undefined) {
      report[altField] = data;
    } else {
      report[primaryField] = data;
    }

    // Write back to S3
    await uploadFile(item.reportKey.replace(/^meeting-minutes\//, ""), JSON.stringify(report, null, 2), "application/json");

    // Update DynamoDB updatedAt
    await docClient.send(new UpdateCommand({
      TableName: TABLE,
      Key: { meetingId: req.params.id, createdAt: item.createdAt },
      UpdateExpression: "SET content = :c, updatedAt = :u",
      ExpressionAttributeValues: {
        ":c": report,
        ":u": new Date().toISOString(),
      },
    }));

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// Auto-generate meeting name from report summary
router.post("/:id/auto-name", async (req, res, next) => {
  try {
    const item = await getMeetingById(req.params.id);
    if (!item) return res.status(404).json({ error: "Not found" });
    if (!item.reportKey) return res.status(400).json({ error: "Report not generated yet" });

    // Read report from S3
    const stream = await getFile(item.reportKey);
    const chunks = [];
    for await (const chunk of stream) {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    }
    const report = JSON.parse(Buffer.concat(chunks).toString("utf-8"));

    const summary = (report.summary || report.executive_summary || "").slice(0, 400);
    if (!summary) {
      return res.status(400).json({ error: "Report has no summary" });
    }

    const dateStr = item.createdAt
      ? new Date(item.createdAt).toISOString().slice(0, 10).replace(/-/g, "")
      : new Date().toISOString().slice(0, 10).replace(/-/g, "");

    const prompt = `你是会议助手。根据以下会议摘要，生成一个简洁的会议主题名称。

格式要求：
- 用短横线"-"分隔，共2-3段
- 第一段：会议类型（内部会议/客户会议/技术讨论/周会等，从摘要推断）
- 第二段：核心主题（10字以内，突出关键内容）
- 第三段：日期（YYYYMMDD格式）固定为 ${dateStr}
- 例：内部会议-AWS医疗GenAI讨论-20260226
- 例：客户会议-思格Connect进展同步-20260226
- 只返回名称本身，不要任何解释

会议摘要：
${summary}`;

    const { BedrockRuntimeClient, InvokeModelCommand } = require("@aws-sdk/client-bedrock-runtime");
    const client = new BedrockRuntimeClient({ region: process.env.AWS_REGION });
    const resp = await client.send(new InvokeModelCommand({
      modelId: HAIKU_MODEL_ID,
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify({
        anthropic_version: "bedrock-2023-05-31",
        max_tokens: 200,
        messages: [{ role: "user", content: prompt }],
      }),
    }));

    const result = JSON.parse(new TextDecoder().decode(resp.body));
    const suggestedName = result.content[0].text.trim().slice(0, 60);

    res.json({ suggestedName });
  } catch (err) {
    next(err);
  }
});

// Manually trigger email sending
router.post("/:id/send-email", async (req, res, next) => {
  try {
    const item = await getMeetingById(req.params.id);
    if (!item) return res.status(404).json({ error: "Meeting not found" });
    if (!item.reportKey) return res.status(400).json({ error: "Report not generated yet" });

    const exportQueueUrl = process.env.SQS_EXPORT_QUEUE;
    if (!exportQueueUrl) {
      return res.status(500).json({ error: "Export queue not configured" });
    }

    // Update stage to exporting
    await docClient.send(new UpdateCommand({
      TableName: TABLE,
      Key: { meetingId: req.params.id, createdAt: item.createdAt },
      UpdateExpression: "SET stage = :stage, updatedAt = :u",
      ExpressionAttributeValues: {
        ":stage": "exporting",
        ":u": new Date().toISOString(),
      },
    }));

    await sendMessage(exportQueueUrl, {
      meetingId: req.params.id,
      reportKey: item.reportKey,
      createdAt: item.createdAt,
    });

    res.json({ success: true, message: "Email sending triggered" });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
