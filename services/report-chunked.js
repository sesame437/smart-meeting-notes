"use strict";

const { invokeModelRaw } = require("./bedrock");
const { extractJsonFromLLMResponse } = require("./report-builder");
const { buildStructuredGlossaryNote } = require("./glossary-prompt-builder");
const logger = require("./logger");

const SYSTEM_PROMPT = "你是专业会议纪要助手。严格基于转录文本中的内容生成报告，不要编造或推测任何未在转录中出现的信息。每个 JSON 字段值必须语义完整、独立。只输出 JSON，不要其他文字。";

function buildSpeakerNote(transcriptText, speakerMap) {
  if (speakerMap && Object.keys(speakerMap).length > 0) {
    const mapping = Object.entries(speakerMap).map(([k, v]) => `${k}: ${v}`).join(", ");
    const nameList = [...new Set(Object.values(speakerMap))].join("、");
    return `参会人真实姓名映射：{${mapping}}\n请使用真实姓名，严禁匿名代号。只允许使用：${nameList}。\n【owner/负责人归属铁律】：每个项目/议题的 owner 必须是转录中实际汇报该项目的说话人（即 [SPEAKER_X] 标签对应的真实姓名）。判断依据是"谁在讲这个项目的内容"，而非"项目讨论中提到了谁的名字"。严禁将主持人/提问者错误归为项目 owner。\n\n`;
  }
  if (transcriptText.includes("[SPEAKER_")) {
    return `转录含说话人标签 [SPEAKER_X]。owner/负责人字段规则：优先填写转录中明确提到的真实人名，无法确定时填 SPEAKER_X，禁止留空。participants 以 SPEAKER_X 为标识。speakerKeypoints 以 SPEAKER_X 为 key。\n\n`;
  }
  return `转录中没有说话人标签，不要推测说话人身份，专注于讨论内容。owner 字段从转录内容中提取人名，无法确定则填"待定"，禁止留空。participants 输出空数组，speakerKeypoints 输出空对象。\n\n`;
}

function buildGlossaryNote(glossaryTerms) {
  return buildStructuredGlossaryNote(glossaryTerms);
}

function buildPhase1Prompt(transcriptText, glossaryTerms, speakerMap) {
  const speaker = buildSpeakerNote(transcriptText, speakerMap);
  const glossary = buildGlossaryNote(glossaryTerms);
  return `${speaker}${glossary}分析以下 AWS SA 团队周例会转录文本，生成结构化会议纪要的第一部分：总结、参会人、KPI、公告、决策。

注意：若 teamKPI 或 announcements 在转录中未明确提及，输出空数组，不要编造。

转录文本：${transcriptText}

以 JSON 输出以下字段（只输出这些，不要 projectReviews/actions/highlights/lowlights）：
{
  "meetingType": "weekly",
  "summary": "本次周会总结（2-3句话）",
  "participants": ["发言人角色"],
  "teamKPI": {
    "overview": "团队 KPI 概述",
    "individuals": [{ "name": "姓名或角色", "kpi": "KPI 要点", "status": "on-track/at-risk/completed" }]
  },
  "announcements": [{ "title": "标题", "detail": "内容", "owner": "发布人" }],
  "decisions": [{ "decision": "决策", "rationale": "原因", "owner": "决策人" }],
  "nextMeeting": "下次会议时间（如有）",
  "speakerKeypoints": {
    "SPEAKER_0": ["该说话人核心观点，至少50字，含具体数据和上下文"]
  }
}
只输出 JSON。`;
}

function buildPhase2Prompt(transcriptText, glossaryTerms, speakerMap) {
  const speaker = buildSpeakerNote(transcriptText, speakerMap);
  const glossary = buildGlossaryNote(glossaryTerms);
  return `${speaker}${glossary}分析以下 AWS SA 团队周例会转录文本，只生成客户/项目逐个 Review 部分。每个项目/客户单独一条，逐项拆分不要合并。

【owner 归属铁律 — 违反即视为错误】
1. 每个 projectReview 的 followUps.owner = 转录中连续讲述该项目内容的那个 [说话人]
2. 判断标准：谁在 [ ] 标签后面说了该项目的具体进展/细节/技术内容，谁就是 owner
3. 主持人（通常是发问、简短回应"好继续""对"的那个人）不是项目 owner
4. 举例：如果转录中出现 "[马立博] 康龙的这个H20需求..."，则康龙相关项目的 owner 是"马立博"
5. 禁止将多个不同人汇报的项目统一归给同一个人

转录文本：${transcriptText}

以 JSON 输出（只输出 projectReviews 数组）：
{
  "projectReviews": [
    {
      "project": "项目/客户名称",
      "progress": "本周进展概述",
      "followUps": [{ "task": "跟进事项", "owner": "实际汇报该项目的说话人", "deadline": "截止时间", "status": "new/in-progress/blocked" }],
      "highlights": [{ "point": "亮点", "detail": "详情" }],
      "lowlights": [{ "point": "问题", "detail": "影响" }],
      "risks": [{ "risk": "风险", "impact": "high/medium/low", "mitigation": "措施" }],
      "challenges": [{ "challenge": "挑战", "detail": "背景" }]
    }
  ]
}
只输出 JSON。`;
}

function buildPhase3Prompt(transcriptText, glossaryTerms, speakerMap) {
  const speaker = buildSpeakerNote(transcriptText, speakerMap);
  const glossary = buildGlossaryNote(glossaryTerms);
  return `${speaker}${glossary}分析以下 AWS SA 团队周例会转录文本，只生成行动项、亮点和问题部分。

转录文本：${transcriptText}

以 JSON 输出（只输出以下字段）：
{
  "actions": [{ "task": "行动项", "owner": "负责人", "deadline": "截止日期", "priority": "high/medium/low", "project": "关联项目" }],
  "highlights": [{ "point": "亮点", "detail": "详情" }],
  "lowlights": [{ "point": "问题/风险", "detail": "详情" }]
}
只输出 JSON。`;
}

async function invokePhase(phaseName, prompt, maxRetries = 2) {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const raw = await invokeModelRaw(SYSTEM_PROMPT, prompt, { maxTokens: 16000 });
      return extractJsonFromLLMResponse(raw);
    } catch (err) {
      lastError = err;
      logger.warn("report-chunked", `${phaseName}-retry`, { attempt, error: err.message });
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }
  throw lastError;
}

/**
 * Deterministically fix projectReview owners using layered strategies:
 * 1. Glossary lookup: if a glossary entry for the project/company has an `owner` field, use it directly (zero inference).
 * 2. First non-moderator mention: find the first transcript line where a non-moderator speaker mentions the project name.
 * 3. Keep Bedrock's original owner if it's a valid non-moderator participant (last resort).
 */
function fixProjectReviewOwners(projectReviews, transcriptText, speakerMap, glossaryTerms = []) {
  if (!projectReviews || projectReviews.length === 0) return projectReviews;
  if (!speakerMap || Object.keys(speakerMap).length === 0) return projectReviews;

  const lines = transcriptText.split("\n");
  const speakerNames = [...new Set(Object.values(speakerMap).filter(Boolean))];
  const speakerPattern = /^\[([^\]]+)\]\s/;

  // Build per-line speaker index
  const lineSpeakers = [];
  for (const line of lines) {
    const m = line.match(speakerPattern);
    if (m) {
      const label = m[1];
      lineSpeakers.push(speakerMap[label] || (speakerNames.includes(label) ? label : null));
    } else {
      lineSpeakers.push(lineSpeakers.length > 0 ? lineSpeakers[lineSpeakers.length - 1] : null);
    }
  }

  // Detect moderator: speaker with most total lines
  const totalLineCounts = {};
  for (const spk of lineSpeakers) {
    if (spk) totalLineCounts[spk] = (totalLineCounts[spk] || 0) + 1;
  }
  const sorted = Object.entries(totalLineCounts).sort((a, b) => b[1] - a[1]);
  const moderator = sorted.length > 0 ? sorted[0][0] : null;

  // Build glossary owner lookup: project/company name (+ aliases) → owner
  const glossaryOwnerMap = {};
  for (const item of glossaryTerms) {
    if (!item.owner) continue;
    const allNames = [item.term];
    if (Array.isArray(item.aliases)) {
      allNames.push(...item.aliases);
    } else if (typeof item.aliases === "string" && item.aliases) {
      allNames.push(...item.aliases.split(/[,，]/).map(s => s.trim()));
    }
    for (const name of allNames.filter(Boolean)) {
      glossaryOwnerMap[name.toLowerCase()] = item.owner;
    }
  }

  for (const pr of projectReviews) {
    const projectName = pr.project || "";
    const mainName = projectName.split(/[\s]*[-—（(]/)[0].trim();
    if (mainName.length < 2) continue;

    // Build search keys from project name (full + short prefix for fuzzy matching)
    const searchKeys = [mainName.toLowerCase()];
    const parenMatch = projectName.match(/[（(]([^）)]+)[）)]/);
    if (parenMatch) searchKeys.push(parenMatch[1].trim().toLowerCase());
    // Add short prefixes (2 and 4 chars) to handle verbose project names like "国创气象预测项目"
    if (mainName.length > 2) {
      for (const len of [2, 4]) {
        if (mainName.length <= len) continue;
        const prefix = mainName.slice(0, len).toLowerCase();
        if (!searchKeys.includes(prefix)) searchKeys.push(prefix);
      }
    }

    // Strategy 1: glossary owner lookup (highest confidence)
    let finalOwner = null;
    for (const key of searchKeys) {
      if (glossaryOwnerMap[key]) { finalOwner = glossaryOwnerMap[key]; break; }
    }
    // Also try partial match: glossary term contained in project name or vice versa
    if (!finalOwner) {
      for (const [gKey, gOwner] of Object.entries(glossaryOwnerMap)) {
        if (searchKeys.some(sk => sk.includes(gKey) || gKey.includes(sk))) {
          finalOwner = gOwner;
          break;
        }
      }
    }

    // Strategy 2: first non-moderator transcript line mentioning project name
    if (!finalOwner) {
      for (let i = 0; i < lines.length; i++) {
        if (lineSpeakers[i] === moderator) continue;
        const lower = lines[i].toLowerCase();
        if (searchKeys.some(term => lower.includes(term))) {
          finalOwner = lineSpeakers[i];
          break;
        }
      }
    }

    // Strategy 3: keep Bedrock's original if it's a valid non-moderator participant
    if (!finalOwner) {
      const existingOwners = (pr.followUps || []).map(f => f.owner).filter(Boolean);
      const validOwner = existingOwners.find(o => o !== moderator && speakerNames.includes(o));
      if (validOwner) finalOwner = validOwner;
    }

    if (!finalOwner) continue;

    // Apply owner to all followUps
    for (const fu of (pr.followUps || [])) {
      if (!fu.owner || fu.owner === moderator || speakerNames.includes(fu.owner)) {
        fu.owner = finalOwner;
      }
    }
  }

  return projectReviews;
}

/**
 * Generate a weekly meeting report in 3 phases to avoid token-repetition hallucinations.
 * Each phase outputs a subset of the final report JSON, keeping output under ~15K tokens.
 */
async function generateReportChunked(transcriptText, meetingType, glossaryTerms = [], speakerMap = null) {
  logger.info("report-chunked", "starting", { meetingType, phases: 3 });

  const phase1 = await invokePhase("phase1-metadata", buildPhase1Prompt(transcriptText, glossaryTerms, speakerMap));
  logger.info("report-chunked", "phase1-done", {
    participants: phase1.participants?.length || 0,
    announcements: phase1.announcements?.length || 0,
  });

  let phase2 = await invokePhase("phase2-projects", buildPhase2Prompt(transcriptText, glossaryTerms, speakerMap));
  if (speakerMap && phase2.projectReviews) {
    phase2.projectReviews = fixProjectReviewOwners(phase2.projectReviews, transcriptText, speakerMap, glossaryTerms);
  }
  logger.info("report-chunked", "phase2-done", {
    projectReviews: phase2.projectReviews?.length || 0,
  });

  const phase3 = await invokePhase("phase3-actions", buildPhase3Prompt(transcriptText, glossaryTerms, speakerMap));
  logger.info("report-chunked", "phase3-done", {
    actions: phase3.actions?.length || 0,
  });

  const report = {
    meetingType: "weekly",
    summary: phase1.summary || "",
    participants: phase1.participants || [],
    teamKPI: phase1.teamKPI || { overview: "", individuals: [] },
    announcements: phase1.announcements || [],
    decisions: phase1.decisions || [],
    nextMeeting: phase1.nextMeeting || "",
    speakerKeypoints: phase1.speakerKeypoints || {},
    projectReviews: phase2.projectReviews || [],
    actions: phase3.actions || [],
    highlights: phase3.highlights || [],
    lowlights: phase3.lowlights || [],
  };

  logger.info("report-chunked", "merged", {
    projectReviews: report.projectReviews.length,
    actions: report.actions.length,
  });

  return report;
}

module.exports = {
  generateReportChunked,
  fixProjectReviewOwners,
  buildPhase1Prompt,
  buildPhase2Prompt,
  buildPhase3Prompt,
};
