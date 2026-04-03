"use strict";

const { invokeModelRaw } = require("./bedrock");
const { extractJsonFromLLMResponse } = require("./report-builder");
const logger = require("./logger");

const SYSTEM_PROMPT = "你是专业会议纪要助手。严格基于转录文本中的内容生成报告，不要编造或推测任何未在转录中出现的信息。每个 JSON 字段值必须语义完整、独立。只输出 JSON，不要其他文字。";

function buildSpeakerNote(transcriptText, speakerMap) {
  if (speakerMap && Object.keys(speakerMap).length > 0) {
    const mapping = Object.entries(speakerMap).map(([k, v]) => `${k}: ${v}`).join(", ");
    const nameList = [...new Set(Object.values(speakerMap))].join("、");
    return `参会人真实姓名映射：{${mapping}}\n请使用真实姓名，严禁匿名代号。只允许使用：${nameList}。\n\n`;
  }
  if (transcriptText.includes("[SPEAKER_")) {
    return `转录含说话人标签 [SPEAKER_X]，请推断身份（如主持人、成员A），使用角色名称。人名只能来自转录中明确出现的名字，严禁编造。\n\n`;
  }
  return "";
}

function buildGlossaryNote(glossaryTerms) {
  if (!glossaryTerms || glossaryTerms.length === 0) return "";
  return `专有名词词库（确保正确拼写）：${glossaryTerms.join("、")}\n\n`;
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

转录文本：${transcriptText}

以 JSON 输出（只输出 projectReviews 数组）：
{
  "projectReviews": [
    {
      "project": "项目/客户名称",
      "progress": "本周进展概述",
      "followUps": [{ "task": "跟进事项", "owner": "负责人", "deadline": "截止时间", "status": "new/in-progress/blocked" }],
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

  const phase2 = await invokePhase("phase2-projects", buildPhase2Prompt(transcriptText, glossaryTerms, speakerMap));
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
  buildPhase1Prompt,
  buildPhase2Prompt,
  buildPhase3Prompt,
};
