const crypto = require("crypto");
const { docClient } = require("../../db/dynamodb");
const {
  ScanCommand,
  PutCommand,
  UpdateCommand,
} = require("@aws-sdk/lib-dynamodb");
const { uploadFile, getFile } = require("../../services/s3");
const { invokeModel } = require("../../services/bedrock");
const logger = require("../../services/logger");
const {
  TABLE,
  GLOSSARY_TABLE,
  HAIKU_MODEL_ID,
  getMeetingById,
  validateSpeakerMap,
  readTranscriptParts,
} = require("./helpers");

function register(router) {
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
            logger.warn("meetings-route", "merge-read-report-failed", { meetingId: m.meetingId, error: err.message });
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
        logger.warn("meetings-route", "merge-fetch-glossary-failed", { error: err.message });
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
      await uploadFile(reportKey, JSON.stringify(report, null, 2), "application/json");

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
          reportKey: reportKey,
          createdAt: now,
        },
      }));

      // Note: email is sent manually via POST /:id/send-email
      res.status(201).json({ meetingId, report, skipped });
    } catch (err) {
      next(err);
    }
  });

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
        logger.warn("meetings-route", "regenerate-fetch-glossary-failed", { error: err.message });
      }

      const modelId = process.env.BEDROCK_MODEL_ID || undefined;
      const responseText = await invokeModel(transcriptText, meetingType, glossaryTerms, modelId, speakerMap);

      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return res.status(500).json({ error: "Failed to parse report from Bedrock" });
      }
      const report = JSON.parse(jsonMatch[0]);

      const reportKey = `reports/${req.params.id}/report.json`;
      await uploadFile(reportKey, JSON.stringify(report, null, 2), "application/json");

      await docClient.send(new UpdateCommand({
        TableName: TABLE,
        Key: { meetingId: req.params.id, createdAt: item.createdAt },
        UpdateExpression: "SET content = :c, reportKey = :rk, #s = :s, stage = :stage, updatedAt = :u",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: {
          ":c": report,
          ":rk": reportKey,
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
        logger.warn("meetings-route", "speaker-map-fetch-glossary-failed", { error: err.message });
      }

      const modelId = process.env.BEDROCK_MODEL_ID || undefined;
      const responseText = await invokeModel(transcriptText, meetingType, glossaryTerms, modelId, speakerMap);

      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return res.status(500).json({ error: "Failed to parse report from Bedrock" });
      }
      const report = JSON.parse(jsonMatch[0]);

      const reportKey = `reports/${req.params.id}/report.json`;
      await uploadFile(reportKey, JSON.stringify(report, null, 2), "application/json");

      await docClient.send(new UpdateCommand({
        TableName: TABLE,
        Key: { meetingId: req.params.id, createdAt: item.createdAt },
        UpdateExpression: "SET content = :c, reportKey = :rk, #s = :s, stage = :stage, updatedAt = :u",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: {
          ":c": report,
          ":rk": reportKey,
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
      const validSections = ["summary", "actionItems", "keyDecisions", "participants", "highlights", "lowlights"];
      if (!validSections.includes(section)) {
        return res.status(400).json({ error: "Invalid section. Must be one of: summary, actionItems, keyDecisions, participants, highlights, lowlights" });
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
        participants: "participants",
        highlights: "highlights",
        lowlights: "lowlights",
      };
      // Also check alternative field names from Bedrock output
      const altFieldMap = {
        summary: "executive_summary",
        actionItems: "actions",
        keyDecisions: "key_decisions",
        participants: "attendees",
        highlights: "highlights",
        lowlights: "lowlights",
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
      await uploadFile(item.reportKey, JSON.stringify(report, null, 2), "application/json");

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
}

module.exports = register;
