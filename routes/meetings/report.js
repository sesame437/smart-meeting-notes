const crypto = require("crypto");
const { z } = require("zod");
const { uploadFile, getFile } = require("../../services/s3");
const { invokeModel } = require("../../services/bedrock");
const { extractJsonFromLLMResponse } = require("../../services/report-builder");
const logger = require("../../services/logger");
const store = require("../../services/meeting-store");
const glossaryStore = require("../../services/glossary-store");
const {
  HAIKU_MODEL_ID,
  getMeetingById,
  validateSpeakerMap,
  readTranscriptParts,
} = require("./helpers");

const mergeSchema = z.object({
  meetingIds: z.array(z.string().uuid()).min(2),
  customPrompt: z.string().max(500).optional(),
});

const speakerNamesSchema = z.object({
  speakerMap: z.record(z.string().min(1), z.string()),
});

function register(router) {
  // Merge multiple meetings into a combined report
  router.post("/merge", async (req, res, next) => {
    try {
      // Validate request body with zod
      const parseResult = mergeSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: parseResult.error.message } });
      }

      const { meetingIds, customPrompt } = parseResult.data;

      // Additional validation: max 10 items
      if (meetingIds.length > 10) {
        return res.status(400).json({ error: { code: "MEETING_IDS_LIMIT_EXCEEDED", message: "meetingIds cannot exceed 10 items" } });
      }

      // Fetch all meeting records
      const meetings = [];
      for (const id of meetingIds) {
        const item = await getMeetingById(id);
        if (!item) return res.status(404).json({ error: { code: "MEETING_NOT_FOUND", message: `Meeting not found: ${id}` } });
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
        return res.status(400).json({ error: { code: "NO_REPORT_CONTENT", message: "所有会议均无报告内容" } });
      }

      const mergedText = mergedParts.join("\n\n");

      // Fetch glossary terms
      let glossaryTerms = [];
      try {
        const glossaryItems = await store.getGlossaryItems();
        glossaryTerms = glossaryItems.map(i => i.termId).filter(Boolean);
      } catch (err) {
        logger.warn("meetings-route", "merge-fetch-glossary-failed", { error: err.message });
      }

      // Call Bedrock
      const modelId = process.env.BEDROCK_MODEL_ID || undefined;
      const responseText = await invokeModel(mergedText, "merged", glossaryTerms, modelId, null, customPrompt || null);

      // Parse report JSON
      const report = extractJsonFromLLMResponse(responseText);

      // Create merged meeting record
      const meetingId = crypto.randomUUID();
      const now = new Date().toISOString();

      // Upload report to S3
      const reportKey = `reports/${meetingId}/report.json`;
      await uploadFile(reportKey, JSON.stringify(report, null, 2), "application/json");

      // Save to DynamoDB
      await store.saveReport({
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
      });

      // Note: email is sent manually via POST /:id/send-email
      res.status(201).json({ meetingId, report, skipped });
    } catch (err) {
      next(err);
    }
  });

  // Save speaker names only (no Bedrock regeneration)
  router.put("/:id/speaker-names", async (req, res, next) => {
    try {
      // Validate request body with zod
      const parseResult = speakerNamesSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: parseResult.error.message } });
      }

      const { speakerMap } = parseResult.data;
      const validationError = validateSpeakerMap(speakerMap);
      if (validationError) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: validationError } });
      }

      const item = await getMeetingById(req.params.id);
      if (!item) return res.status(404).json({ error: { code: "MEETING_NOT_FOUND", message: "Not found" } });

      await store.updateMeetingReport(
        req.params.id,
        item.createdAt,
        "SET speakerMap = :sm, updatedAt = :u",
        {},
        {
          ":sm": speakerMap,
          ":u": new Date().toISOString(),
        }
      );

      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  });

  // Regenerate report using stored speakerMap
  router.post("/:id/apply-speaker-names", async (req, res, next) => {
    try {
      const item = await getMeetingById(req.params.id);
      if (!item) return res.status(404).json({ error: { code: "MEETING_NOT_FOUND", message: "Not found" } });

      const speakerMap = item.speakerMap || {};
      if (Object.keys(speakerMap).length === 0) {
        return res.status(400).json({ error: { code: "NO_SPEAKER_MAP", message: "No speaker map saved" } });
      }

      // Load current report from S3
      const reportKey = item.reportKey;
      if (!reportKey) return res.status(400).json({ error: { code: "NO_REPORT", message: "No report found" } });

      const stream = await getFile(reportKey);
      const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      const report = JSON.parse(Buffer.concat(chunks).toString("utf-8"));

      // Build name replacement map (only entries with real names)
      const nameMap = {};
      Object.entries(speakerMap).forEach(([speakerKey, name]) => {
        if (name && name.trim()) nameMap[speakerKey] = name.trim();
      });

      // Detect duplicate names (one person = multiple speakers → merge)
      const nameToSpeakers = {};
      Object.entries(nameMap).forEach(([spk, name]) => {
        if (!nameToSpeakers[name]) nameToSpeakers[name] = [];
        nameToSpeakers[name].push(spk);
      });

      // Apply: replace SPEAKER_X with real names throughout report JSON
      let reportStr = JSON.stringify(report);
      // Sort by key length desc to avoid partial replacements (SPEAKER_10 before SPEAKER_1)
      const sortedEntries = Object.entries(nameMap).sort((a, b) => b[0].length - a[0].length);
      sortedEntries.forEach(([spk, name]) => {
        reportStr = reportStr.replaceAll(spk, name);
      });

      // Apply glossary alias corrections
      let appliedAliases = [];
      try {
        const glossaryItems = await glossaryStore.listGlossary();

        // Build alias→term map (only process items with aliases)
        const aliasMap = {};
        glossaryItems.forEach(item => {
          if (!item.aliases) return;
          const aliases = typeof item.aliases === "string"
            ? item.aliases.split(/[,，]/).map(s => s.trim()).filter(Boolean)
            : item.aliases;
          aliases.forEach(alias => {
            if (alias && alias !== item.term) {
              aliasMap[alias] = item.term;
            }
          });
        });

        // Apply alias replacements (sort by length desc to avoid partial replacements)
        const sortedAliases = Object.keys(aliasMap).sort((a, b) => b.length - a.length);
        const alreadyReplaced = new Set();
        sortedAliases.forEach(alias => {
          const term = aliasMap[alias];
          if (alias === term) return;
          if (alreadyReplaced.has(alias)) return;
          const jsonEscapedAlias = JSON.stringify(alias).slice(1, -1);
          if (!reportStr.includes(jsonEscapedAlias)) return;

          if (term.includes(alias)) {
            // alias is a substring of term (e.g. "佩佳" in "王佩佳")
            // Only replace when alias is NOT already preceded by the term's prefix
            const prefix = term.slice(0, term.indexOf(alias));
            const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const escapedAlias = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const safeRegex = new RegExp(`(?<!${escapedPrefix})${escapedAlias}`, 'g');
            const before = reportStr;
            reportStr = reportStr.replace(safeRegex, term);
            if (reportStr !== before) {
              appliedAliases.push({ from: alias, to: term });
              Object.entries(aliasMap).forEach(([a, t]) => { if (t === term) alreadyReplaced.add(a); });
            }
          } else {
            reportStr = reportStr.replaceAll(alias, term);
            appliedAliases.push({ from: alias, to: term });
            Object.entries(aliasMap).forEach(([a, t]) => { if (t === term) alreadyReplaced.add(a); });
          }
        });
      } catch (err) {
        logger.warn("meetings-route", "apply-speaker-names-glossary-failed", { error: err.message });
      }

      const updatedReport = JSON.parse(reportStr);

      // Merge speakerKeypoints for duplicate names
      if (updatedReport.speakerKeypoints) {
        const merged = {};
        Object.entries(updatedReport.speakerKeypoints).forEach(([key, points]) => {
          if (!merged[key]) merged[key] = [];
          merged[key] = merged[key].concat(points);
        });
        updatedReport.speakerKeypoints = merged;
      }

      // Deduplicate participants
      if (Array.isArray(updatedReport.participants)) {
        const seen = new Set();
        updatedReport.participants = updatedReport.participants.filter(p => {
          const key = typeof p === "string" ? p : JSON.stringify(p);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      }

      // Deduplicate awsAttendees
      if (Array.isArray(updatedReport.awsAttendees)) {
        updatedReport.awsAttendees = [...new Set(updatedReport.awsAttendees)];
      }

      // Deduplicate customerInfo.attendees
      if (updatedReport.customerInfo && Array.isArray(updatedReport.customerInfo.attendees)) {
        updatedReport.customerInfo.attendees = [...new Set(updatedReport.customerInfo.attendees)];
      }

      // Write back to S3
      await uploadFile(reportKey, JSON.stringify(updatedReport, null, 2), "application/json");

      res.json({
        ok: true,
        appliedNames: Object.keys(nameMap).length,
        aliasReplacements: appliedAliases
      });
    } catch (err) {
      next(err);
    }
  });

  // Regenerate report using stored speakerMap
  router.post("/:id/regenerate", async (req, res, next) => {
    try {
      const item = await getMeetingById(req.params.id);
      if (!item) return res.status(404).json({ error: { code: "MEETING_NOT_FOUND", message: "Not found" } });

      const speakerMap = item.speakerMap || null;

      const transcriptParts = await readTranscriptParts(item);
      if (transcriptParts.length === 0) {
        return res.status(400).json({ error: { code: "NO_TRANSCRIPT", message: "No transcript found for this meeting" } });
      }

      const transcriptText = transcriptParts.join("\n\n");
      const meetingType = item.meetingType || "general";

      // Fetch glossary terms
      let glossaryTerms = [];
      try {
        const glossaryItems = await store.getGlossaryItems();
        glossaryTerms = glossaryItems.map(i => i.termId).filter(Boolean);
      } catch (err) {
        logger.warn("meetings-route", "regenerate-fetch-glossary-failed", { error: err.message });
      }

      const modelId = process.env.BEDROCK_MODEL_ID || undefined;
      const responseText = await invokeModel(transcriptText, meetingType, glossaryTerms, modelId, speakerMap);

      const report = extractJsonFromLLMResponse(responseText);

      const reportKey = `reports/${req.params.id}/report.json`;
      await uploadFile(reportKey, JSON.stringify(report, null, 2), "application/json");

      await store.updateMeetingReport(
        req.params.id,
        item.createdAt,
        "SET content = :c, reportKey = :rk, #s = :s, stage = :stage, updatedAt = :u",
        { "#s": "status" },
        {
          ":c": report,
          ":rk": reportKey,
          ":s": "reported",
          ":stage": "done",
          ":u": new Date().toISOString(),
        }
      );

      // Note: email is sent manually via POST /:id/send-email
      res.json({ success: true, report });
    } catch (err) {
      next(err);
    }
  });

  // Legacy: Update speaker map and regenerate report (kept for backwards compatibility)
  router.put("/:id/speaker-map", async (req, res, next) => {
    try {
      // Validate request body with zod
      const parseResult = speakerNamesSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: parseResult.error.message } });
      }

      const { speakerMap } = parseResult.data;
      const validationError = validateSpeakerMap(speakerMap);
      if (validationError) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: validationError } });
      }

      const item = await getMeetingById(req.params.id);
      if (!item) return res.status(404).json({ error: { code: "MEETING_NOT_FOUND", message: "Not found" } });

      // Save speakerMap to DynamoDB
      await store.updateMeetingReport(
        req.params.id,
        item.createdAt,
        "SET speakerMap = :sm, updatedAt = :u",
        {},
        {
          ":sm": speakerMap,
          ":u": new Date().toISOString(),
        }
      );

      const transcriptParts = await readTranscriptParts(item);
      if (transcriptParts.length === 0) {
        return res.status(400).json({ error: { code: "NO_TRANSCRIPT", message: "No transcript found for this meeting" } });
      }

      const transcriptText = transcriptParts.join("\n\n");
      const meetingType = item.meetingType || "general";

      let glossaryTerms = [];
      try {
        const glossaryItems = await store.getGlossaryItems();
        glossaryTerms = glossaryItems.map(i => i.termId).filter(Boolean);
      } catch (err) {
        logger.warn("meetings-route", "speaker-map-fetch-glossary-failed", { error: err.message });
      }

      const modelId = process.env.BEDROCK_MODEL_ID || undefined;
      const responseText = await invokeModel(transcriptText, meetingType, glossaryTerms, modelId, speakerMap);

      const report = extractJsonFromLLMResponse(responseText);

      const reportKey = `reports/${req.params.id}/report.json`;
      await uploadFile(reportKey, JSON.stringify(report, null, 2), "application/json");

      await store.updateMeetingReport(
        req.params.id,
        item.createdAt,
        "SET content = :c, reportKey = :rk, #s = :s, stage = :stage, updatedAt = :u",
        { "#s": "status" },
        {
          ":c": report,
          ":rk": reportKey,
          ":s": "reported",
          ":stage": "done",
          ":u": new Date().toISOString(),
        }
      );

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
      const validSections = ["summary", "actions", "decisions", "participants", "highlights", "lowlights", "announcements", "projectReviews"];
      if (!validSections.includes(section)) {
        return res.status(400).json({ error: { code: "INVALID_SECTION", message: "Invalid section" } });
      }
      if (data === undefined || data === null) {
        return res.status(400).json({ error: { code: "DATA_REQUIRED", message: "data is required" } });
      }

      const item = await getMeetingById(req.params.id);
      if (!item) return res.status(404).json({ error: { code: "MEETING_NOT_FOUND", message: "Not found" } });
      if (!item.reportKey) return res.status(400).json({ error: { code: "NO_REPORT", message: "No report exists for this meeting" } });

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
        actions: "actions",
        decisions: "decisions",
        participants: "participants",
        highlights: "highlights",
        lowlights: "lowlights",
        announcements: "announcements",
        projectReviews: "projectReviews",
      };
      const primaryField = fieldMap[section];
      // Always write to the canonical field name
      report[primaryField] = data;

      // Write back to S3
      await uploadFile(item.reportKey, JSON.stringify(report, null, 2), "application/json");

      // Update DynamoDB updatedAt
      await store.updateMeetingReport(
        req.params.id,
        item.createdAt,
        "SET content = :c, updatedAt = :u",
        {},
        {
          ":c": report,
          ":u": new Date().toISOString(),
        }
      );

      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  });

  // Auto-generate meeting name from report summary
  router.post("/:id/auto-name", async (req, res, next) => {
    try {
      const item = await getMeetingById(req.params.id);
      if (!item) return res.status(404).json({ error: { code: "MEETING_NOT_FOUND", message: "Not found" } });
      if (!item.reportKey) return res.status(400).json({ error: { code: "REPORT_NOT_GENERATED", message: "Report not generated yet" } });

      // Read report from S3
      const stream = await getFile(item.reportKey);
      const chunks = [];
      for await (const chunk of stream) {
        chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
      }
      const report = JSON.parse(Buffer.concat(chunks).toString("utf-8"));

      const summary = (report.summary || "").slice(0, 400);
      if (!summary) {
        return res.status(400).json({ error: { code: "NO_REPORT_SUMMARY", message: "Report has no summary" } });
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
