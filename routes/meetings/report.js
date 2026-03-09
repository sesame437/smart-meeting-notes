const crypto = require("crypto");
const { z } = require("zod");
const { uploadFile, getFile } = require("../../services/s3");
const { invokeModel } = require("../../services/bedrock");
const { extractJsonFromLLMResponse } = require("../../services/report-builder");
const logger = require("../../services/logger");
const store = require("../../services/meeting-store");
const glossaryStore = require("../../services/glossary-store");
const { normalizeAnonymousSpeakerReport } = require("../../services/report-speaker-normalizer");
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
  speakerAliases: z.record(z.string().min(1), z.array(z.string())).optional(),
});

function collectSpeakerAliasMap(participants, nameMap, savedSpeakerAliases = {}, existingRoster = []) {
  const aliasMap = {};
  const isIgnorableAliasFragment = (value) => {
    if (!value) return true;
    if (/^SPEAKER_\d+$/.test(value)) return true;
    if (/(方向|负责人|团队|开发者|角色|项目|平台|workshop|demo|SA|BD|IT|POC)/i.test(value)) return true;
    if (/^[A-Z]{1,4}$/i.test(value)) return true;
    return false;
  };
  const resolveRosterSpeakerKey = (entry, index) => {
    const rawKey = entry && typeof entry.speakerKey === "string" ? entry.speakerKey.trim() : "";
    if (/^SPEAKER_\d+$/.test(rawKey)) return rawKey;

    const values = [
      entry && entry.displayLabel,
      entry && entry.possibleName,
      ...(entry && Array.isArray(entry.aliases) ? entry.aliases : []),
    ]
      .filter(Boolean)
      .map((value) => String(value));

    const matchedByRealName = Object.entries(nameMap).filter(([, realName]) => values.some((value) => value.includes(realName)));
    if (matchedByRealName.length === 1) return matchedByRealName[0][0];

    const explicitSpeakerKey = values
      .map((value) => value.match(/SPEAKER_\d+/))
      .find(Boolean);
    if (explicitSpeakerKey) return explicitSpeakerKey[0];

    const displayMatch = values
      .map((value) => value.match(/参会人\s*(\d+)/))
      .find(Boolean);
    if (displayMatch) return `SPEAKER_${Math.max(Number(displayMatch[1]) - 1, 0)}`;

    return `SPEAKER_${index}`;
  };
  const addAliasVariants = (targetMap, realName, values = []) => {
    const aliases = new Set();

    values
      .filter(Boolean)
      .map((value) => String(value).trim())
      .filter(Boolean)
      .forEach((value) => {
        aliases.add(value);

        const withoutSpeakerKey = value.replace(/SPEAKER_\d+/g, "").replace(/\s+/g, " ").trim();
        if (withoutSpeakerKey) aliases.add(withoutSpeakerKey);

        const withoutParen = value.replace(/[（(][^）)]*[）)]/g, "").trim();
        if (withoutParen) aliases.add(withoutParen);

        [...value.matchAll(/[（(]([^）)]+)[）)]/g)].forEach((match) => {
          const inner = match[1] || "";
          inner
            .split(/[\/、,，]/)
            .map((part) => part.trim())
            .filter(Boolean)
            .forEach((part) => {
              if (isIgnorableAliasFragment(part)) return;
              aliases.add(part);
            });
        });

        withoutSpeakerKey
          .split(/[\/、,，]/)
          .map((part) => part.trim())
          .filter(Boolean)
          .forEach((part) => {
            if (isIgnorableAliasFragment(part)) return;
            aliases.add(part);
          });
      });

    aliases.forEach((alias) => {
      if (!alias || alias === realName) return;
      targetMap[alias] = realName;
    });
  };

  Object.entries(savedSpeakerAliases || {}).forEach(([speakerKey, aliases]) => {
    const realName = nameMap[speakerKey];
    if (!realName || !Array.isArray(aliases)) return;
    addAliasVariants(aliasMap, realName, aliases);
  });

  (participants || []).forEach((participant, index) => {
    const raw = typeof participant === "string"
      ? participant
      : (participant && participant.name) || JSON.stringify(participant);
    const matchedSpeakerKeys = raw.match(/SPEAKER_\d+/g) || [];
    const fallbackSpeakerKey = `SPEAKER_${index}`;
    const speakerKeys = matchedSpeakerKeys.length > 0
      ? matchedSpeakerKeys
      : (nameMap[fallbackSpeakerKey] ? [fallbackSpeakerKey] : []);

    speakerKeys.forEach((speakerKey) => {
      const realName = nameMap[speakerKey];
      if (!realName) return;

      const aliases = new Set([raw]);
      const withoutSpeakerKey = raw
        .replace(/[（(]\s*SPEAKER_\d+\s*[）)]/g, "")
        .trim();
      if (withoutSpeakerKey) aliases.add(withoutSpeakerKey);
      const withoutParen = withoutSpeakerKey.replace(/[（(][^）)]*[）)]/g, "").trim();
      if (withoutParen) aliases.add(withoutParen);

      withoutSpeakerKey
        .split(/[\/、,，]/)
        .map((part) => part.trim())
        .filter(Boolean)
        .forEach((alias) => aliases.add(alias));

      withoutParen
        .split(/[\/、,，]/)
        .map((part) => part.trim())
        .filter(Boolean)
        .forEach((alias) => aliases.add(alias));

      addAliasVariants(aliasMap, realName, Array.from(aliases));
    });
  });

  (existingRoster || []).forEach((entry, index) => {
    if (!entry) return;
    const speakerKey = resolveRosterSpeakerKey(entry, index);
    const realName = nameMap[speakerKey];
    if (!realName) return;

    addAliasVariants(aliasMap, realName, [
      entry.displayLabel,
      entry.possibleName,
      entry.resolvedName,
      `参会人 ${index + 1}`,
      ...(Array.isArray(entry.aliases) ? entry.aliases : []),
    ]);
  });

  return aliasMap;
}

function normalizeDuplicateNames(value, names) {
  if (typeof value === "string") {
    let next = value;
    names.forEach((name) => {
      const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      next = next.replace(new RegExp(`${name}[（(][^）)]*[）)]`, "g"), name);
      next = next.replace(new RegExp(`(?:主持人|成员[A-Z]|参会人\\s*\\d+)[（(]${escapedName}[）)]`, "g"), name);
      next = next.replace(new RegExp(`(?:主持人|成员[A-Z]|参会人\\s*\\d+)[（(]${escapedName}[^）)]*[）)]`, "g"), name);
      next = next.split(`${name}（${name}）`).join(name);
      next = next.split(`${name}(${name})`).join(name);
      next = next.split(`${name}/${name}`).join(name);
      next = next.split(`${name} / ${name}`).join(name);
      next = next.split(`${name}（${name}/`).join(`${name}（`);
      next = next.split(`${name}(${name}/`).join(`${name}(`);
      next = next.split(`${name.charAt(0)}${name}`).join(name);
    });
    return next;
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeDuplicateNames(item, names));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, normalizeDuplicateNames(item, names)])
    );
  }

  return value;
}

function replaceNameAlias(reportStr, alias, realName) {
  if (!alias || !realName || alias === realName) return reportStr;

  const aliasIndex = realName.indexOf(alias);
  if (aliasIndex === -1) {
    return reportStr.replaceAll(alias, realName);
  }

  const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const prefix = realName.slice(0, aliasIndex);
  const suffix = realName.slice(aliasIndex + alias.length);
  let pattern = "";

  if (prefix) pattern += `(?<!${escapeRegex(prefix)})`;
  pattern += escapeRegex(alias);
  if (suffix) pattern += `(?!${escapeRegex(suffix)})`;

  return reportStr.replace(new RegExp(pattern, "g"), realName);
}

function buildSpeakerRoster(report, nameMap, savedSpeakerAliases = {}, existingRoster = []) {
  const stableKeypoints = report.speakerKeypoints || {};
  const rosterMap = new Map();
  const isIgnorableAliasFragment = (value) => {
    if (!value) return true;
    if (/^SPEAKER_\d+$/.test(value)) return true;
    if (/(方向|负责人|团队|开发者|角色|项目|平台|workshop|demo|SA|BD|IT|POC)/i.test(value)) return true;
    if (/^[A-Z]{1,4}$/i.test(value)) return true;
    return false;
  };
  const resolveRosterSpeakerKey = (entry, index) => {
    const rawKey = entry && typeof entry.speakerKey === "string" ? entry.speakerKey.trim() : "";
    if (/^SPEAKER_\d+$/.test(rawKey)) return rawKey;

    const values = [
      entry && entry.displayLabel,
      entry && entry.possibleName,
      ...(entry && Array.isArray(entry.aliases) ? entry.aliases : []),
    ]
      .filter(Boolean)
      .map((value) => String(value));

    const matchedByRealName = Object.entries(nameMap).filter(([, realName]) => values.some((value) => value.includes(realName)));
    if (matchedByRealName.length === 1) return matchedByRealName[0][0];

    const explicitSpeakerKey = values
      .map((value) => value.match(/SPEAKER_\d+/))
      .find(Boolean);
    if (explicitSpeakerKey) return explicitSpeakerKey[0];

    const displayMatch = values
      .map((value) => value.match(/参会人\s*(\d+)/))
      .find(Boolean);
    if (displayMatch) return `SPEAKER_${Math.max(Number(displayMatch[1]) - 1, 0)}`;

    return `SPEAKER_${index}`;
  };

  (existingRoster || []).forEach((entry, index) => {
    if (!entry) return;
    const speakerKey = resolveRosterSpeakerKey(entry, index);
    rosterMap.set(speakerKey, {
      speakerKey,
      displayLabel: entry.displayLabel || `参会人 ${Number(speakerKey.split("_")[1] || 0) + 1}`,
      resolvedName: entry.resolvedName || nameMap[speakerKey] || "",
      possibleName: entry.possibleName || "",
      aliases: Array.isArray(entry.aliases) ? entry.aliases.filter(Boolean) : [],
      keypoints: Array.isArray(entry.keypoints) ? entry.keypoints.filter(Boolean) : [],
    });
  });

  Object.keys(stableKeypoints).forEach((speakerKey) => {
    if (!/^SPEAKER_\d+$/.test(speakerKey)) return;
    if (!rosterMap.has(speakerKey)) {
      rosterMap.set(speakerKey, {
        speakerKey,
        displayLabel: `参会人 ${Number(speakerKey.split("_")[1] || 0) + 1}`,
        resolvedName: nameMap[speakerKey] || "",
        possibleName: "",
        aliases: [],
        keypoints: Array.isArray(stableKeypoints[speakerKey]) ? stableKeypoints[speakerKey] : [],
      });
      return;
    }
    const current = rosterMap.get(speakerKey);
    current.keypoints = Array.isArray(stableKeypoints[speakerKey]) ? stableKeypoints[speakerKey] : current.keypoints;
    current.resolvedName = nameMap[speakerKey] || current.resolvedName;
  });

  Object.entries(savedSpeakerAliases || {}).forEach(([speakerKey, aliases]) => {
    if (!/^SPEAKER_\d+$/.test(speakerKey)) return;
    if (!rosterMap.has(speakerKey)) {
      rosterMap.set(speakerKey, {
        speakerKey,
        displayLabel: `参会人 ${Number(speakerKey.split("_")[1] || 0) + 1}`,
        resolvedName: nameMap[speakerKey] || "",
        possibleName: "",
        aliases: [],
        keypoints: [],
      });
    }
    const current = rosterMap.get(speakerKey);
    const aliasList = Array.isArray(aliases) ? aliases.filter(Boolean) : [];
    current.aliases = Array.from(new Set([...(current.aliases || []), ...aliasList]));
    if (!current.possibleName && current.aliases.length > 0) {
      current.possibleName = current.aliases[0];
    }
    current.resolvedName = nameMap[speakerKey] || current.resolvedName;
  });

  return Array.from(rosterMap.values())
    .sort((a, b) => Number(a.speakerKey.split("_")[1] || 0) - Number(b.speakerKey.split("_")[1] || 0))
    .map((entry) => {
      const aliases = Array.from(new Set((entry.aliases || []).filter(Boolean)));
      const resolvedName = entry.resolvedName || "";
      const candidateKeys = [
        entry.speakerKey,
        resolvedName,
        entry.possibleName || "",
        ...aliases.filter((alias) => !isIgnorableAliasFragment(alias)),
      ].filter(Boolean);
      const keypoints = candidateKeys.reduce((found, key) => {
        if (found.length > 0) return found;
        return Array.isArray(stableKeypoints[key]) ? stableKeypoints[key].filter(Boolean) : [];
      }, Array.isArray(entry.keypoints) ? entry.keypoints.filter(Boolean) : []);

      return {
        speakerKey: entry.speakerKey,
        displayLabel: `参会人 ${Number(entry.speakerKey.split("_")[1] || 0) + 1}`,
        resolvedName,
        possibleName: entry.possibleName || aliases[0] || "",
        aliases,
        keypoints,
      };
    });
}

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
      let report = extractJsonFromLLMResponse(responseText);
      if (!speakerMap || Object.keys(speakerMap).length === 0) {
        report = normalizeAnonymousSpeakerReport(report);
      }

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

      const { speakerMap, speakerAliases } = parseResult.data;
      const validationError = validateSpeakerMap(speakerMap);
      if (validationError) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: validationError } });
      }

      const item = await getMeetingById(req.params.id);
      if (!item) return res.status(404).json({ error: { code: "MEETING_NOT_FOUND", message: "Not found" } });

      await store.updateMeetingReport(
        req.params.id,
        item.createdAt,
        "SET speakerMap = :sm, speakerAliases = :sa, updatedAt = :u",
        {},
        {
          ":sm": speakerMap,
          ":sa": speakerAliases || {},
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
      const participantAliasMap = collectSpeakerAliasMap(
        report.participants,
        nameMap,
        item.speakerAliases || {},
        report.speakerRoster || []
      );
      const speakerRoster = buildSpeakerRoster(report, nameMap, item.speakerAliases || {}, report.speakerRoster || []);

      // Detect duplicate names (one person = multiple speakers → merge)
      const nameToSpeakers = {};
      Object.entries(nameMap).forEach(([spk, name]) => {
        if (!nameToSpeakers[name]) nameToSpeakers[name] = [];
        nameToSpeakers[name].push(spk);
      });

      // Apply: replace SPEAKER_X with real names throughout report JSON
      let reportStr = JSON.stringify(report);
      // Sort by key length desc to avoid partial replacements (SPEAKER_10 before SPEAKER_1)
      const replacementEntries = {
        ...participantAliasMap,
        ...nameMap,
      };
      const sortedEntries = Object.entries(replacementEntries).sort((a, b) => b[0].length - a[0].length);
      sortedEntries.forEach(([alias, name]) => {
        reportStr = replaceNameAlias(reportStr, alias, name);
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

      const updatedReport = normalizeDuplicateNames(JSON.parse(reportStr), Object.values(nameMap));

      // Preserve stable speaker keys for the UI; names live in speakerRoster.
      updatedReport.speakerKeypoints = report.speakerKeypoints || {};
      updatedReport.speakerRoster = speakerRoster;

      // Deduplicate participants
      updatedReport.participants = speakerRoster.map((entry) => entry.resolvedName || entry.displayLabel);

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
      await store.updateMeetingReport(
        req.params.id,
        item.createdAt,
        "SET content = :c, updatedAt = :u",
        {},
        {
          ":c": updatedReport,
          ":u": new Date().toISOString(),
        }
      );

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

      let report = extractJsonFromLLMResponse(responseText);
      if (!speakerMap || Object.keys(speakerMap).length === 0) {
        report = normalizeAnonymousSpeakerReport(report);
      }

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
