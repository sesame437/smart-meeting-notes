"use strict";

const { isValidLP } = require("./interview-lps");

const SYSTEM_NOTE =
  "你是专业的面试评估助手。严格基于面试录音转录文本生成结构化评估报告。" +
  "不要编造或推测转录中未出现的信息。";

const JSON_ONLY = "只输出 JSON，不要包含任何额外文字。";

/**
 * Build the Bedrock prompt for a phone-screen-style interview report.
 * Produces: summary + candidateInfo + qaList + redFlags + recommendation.
 */
function buildPhonescreenPrompt(transcriptText, opts = {}) {
  const glossaryNote = opts.glossaryNote || "";
  const speakerNote = opts.speakerNote || "";
  return `${speakerNote}${glossaryNote}${SYSTEM_NOTE}

这是一次电话筛选（phone screen）面试。请按以下 JSON 输出：

{
  "meetingType": "interview",
  "interviewSubType": "phonescreen",
  "summary": "2-3 句话总体评价",
  "candidateInfo": {
    "name": "候选人姓名（从对话中推断）",
    "position": "应聘职位（如提及）",
    "level": "级别（如 L5/L6，如提及）",
    "interviewer": "面试官姓名（从对话中推断）",
    "interviewType": "电话面试 | 现场面试 | 视频面试"
  },
  "qaList": [
    { "question": "面试官问题原文或要点", "answer": "候选人回答的关键要点，保留项目名/数据/时间线", "assessment": "对该回答的评价（逻辑性、深度、证据）" }
  ],
  "redFlags": [{ "point": "红点标题", "detail": "具体表现" }],
  "recommendation": {
    "decision": "hire / no-hire / inclined-hire / inclined-no-hire",
    "reasoning": "基于整场面试的综合决策理由",
    "suggestedLevel": "建议级别（如适用）",
    "suggestedRole": "建议角色（如适用）"
  },
  "participants": ["候选人姓名", "面试官姓名"],
  "highlights": [{ "point": "亮点", "detail": "详情" }],
  "lowlights": [{ "point": "问题/风险", "detail": "详情" }],
  "actions": [{ "task": "后续行动", "owner": "负责人", "deadline": "截止日期", "priority": "high/medium/low" }],
  "decisions": [{ "decision": "决策内容", "rationale": "决策原因" }],
  "speakerKeypoints": {}
}

要求：
1. qaList 必须覆盖面试中提出的每个实质性问题。
2. redFlags 为空数组也可以，但若发现诚信/能力/文化 fit 方面的信号必须列出。
3. recommendation.decision 必须基于证据，不得留空。

转录文本：${transcriptText}

${JSON_ONLY}`;
}

/**
 * Build the Bedrock prompt for an LP-structured interview report.
 * @param {string} transcriptText
 * @param {string[]} lps - exactly 2 user-chosen LP names from INTERVIEW_LPS
 * @param {object} opts
 */
function buildLpPrompt(transcriptText, lps, opts = {}) {
  if (!Array.isArray(lps) || lps.length !== 2) {
    throw new Error(`buildLpPrompt requires exactly 2 LPs, got ${lps ? lps.length : "none"} (长度)`);
  }
  for (const lp of lps) {
    if (!isValidLP(lp)) {
      throw new Error(`LP "${lp}" is not in the interview LP whitelist (允许值见 services/interview-lps.js)`);
    }
  }
  const glossaryNote = opts.glossaryNote || "";
  const speakerNote = opts.speakerNote || "";
  const [lp1, lp2] = lps;
  return `${speakerNote}${glossaryNote}${SYSTEM_NOTE}

这是一次 Leadership Principle 面试，本场重点考察 ${lp1} 和 ${lp2}。请按以下 JSON 输出：

{
  "meetingType": "interview",
  "interviewSubType": "lp",
  "interviewLPs": ${JSON.stringify(lps)},
  "summary": "2-3 句话总体评价",
  "candidateInfo": {
    "name": "候选人姓名（从对话中推断）",
    "position": "应聘职位（如提及）",
    "level": "级别（如 L5/L6，如提及）",
    "interviewer": "面试官姓名（从对话中推断）",
    "interviewType": "电话面试 | 现场面试 | 视频面试"
  },
  "lpBlocks": [
    {
      "lp": ${JSON.stringify(lp1)},
      "qaList": [
        { "question": "关于 ${lp1} 的面试问题", "answer": "候选人回答的关键要点", "assessment": "对该回答的评价" }
      ]
    },
    {
      "lp": ${JSON.stringify(lp2)},
      "qaList": [
        { "question": "关于 ${lp2} 的面试问题", "answer": "候选人回答的关键要点", "assessment": "对该回答的评价" }
      ]
    }
  ],
  "redFlags": [{ "point": "红点标题", "detail": "具体表现" }],
  "recommendation": {
    "decision": "hire / no-hire / inclined-hire / inclined-no-hire",
    "reasoning": "基于两项 LP 表现的综合决策理由",
    "suggestedLevel": "建议级别（如适用）",
    "suggestedRole": "建议角色（如适用）"
  },
  "participants": ["候选人姓名", "面试官姓名"],
  "highlights": [{ "point": "亮点", "detail": "详情" }],
  "lowlights": [{ "point": "问题/风险", "detail": "详情" }],
  "actions": [{ "task": "后续行动", "owner": "负责人", "deadline": "截止日期", "priority": "high/medium/low" }],
  "decisions": [{ "decision": "决策内容", "rationale": "决策原因" }],
  "speakerKeypoints": {}
}

要求（必须遵守，exactly 2 lpBlocks）：
1. lpBlocks 数组长度**必须恰好为 2**，lp 字段分别为 "${lp1}" 和 "${lp2}"，顺序与上方数组一致。
2. 每个 lpBlock.qaList 至少包含 1 条问答（面试中未覆盖的 LP 仍要保留块，qaList 可用一条说明"本场未深入考察"的条目）。
3. 不要生成 "${lp1}" 和 "${lp2}" 之外的 lp 名称。
4. recommendation.decision 必须基于这两项 LP 的整体表现。

转录文本：${transcriptText}

${JSON_ONLY}`;
}

module.exports = { buildPhonescreenPrompt, buildLpPrompt };
