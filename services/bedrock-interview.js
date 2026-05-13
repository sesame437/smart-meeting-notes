"use strict";

const { isValidLP } = require("./interview-lps");

const SYSTEM_NOTE =
  "你是专业的面试评估助手。严格基于面试录音转录文本生成结构化评估报告。" +
  "不要编造或推测转录中未出现的信息。";

const JSON_ONLY = "只输出 JSON，不要包含任何额外文字。";

/**
 * Phone-screen prompt: minimal structure focused on Q&A depth.
 * Output shape: { summary, qaList: [{question, answer, assessment}] }
 * Intentionally drops generic meeting sections (highlights, lowlights, actions, decisions,
 * redFlags, recommendation, participants, speakerKeypoints) — phone screens are Q&A only.
 */
function buildPhonescreenPrompt(transcriptText, opts = {}) {
  const glossaryNote = opts.glossaryNote || "";
  const speakerNote = opts.speakerNote || "";
  return `${speakerNote}${glossaryNote}${SYSTEM_NOTE}

这是一次电话筛选（phone screen）面试。本场报告**只需要两件事**：一句总体评价 + 一组整理后的问答。严禁输出其他字段。

按以下 JSON 输出：

{
  "meetingType": "interview",
  "interviewSubType": "phonescreen",
  "summary": "2-3 句话总体评价（基于所有问答综合）",
  "qaList": [
    {
      "question": "面试官完整问题 — 把主问和所有后续追问合并成一条完整的考察主题，保留追问的递进关系。",
      "answer": "候选人完整回答的精炼整理（保留项目名、数据、时间线、具体行为），允许 2-5 句。",
      "assessment": "针对本条问答的评估（逻辑性、深度、行为证据是否充分）。"
    }
  ]
}

硬性要求：
1. qaList 要覆盖面试中**每个实质性考察主题**，每个主题是一条。若面试官问了 A→追问 A1→追问 A2，全部合并成一条 qa，不要拆成三条。
2. answer 必须基于转录原文整理，不得编造。候选人未回答的部分如实标注"未作答"。
3. **严禁输出 summary / qaList 之外的任何字段**（比如 highlights、recommendation、redFlags、candidateInfo 等一律不要）。

转录文本：${transcriptText}

${JSON_ONLY}`;
}

/**
 * LP prompt: every output field is scoped to the 2 user-chosen LPs. All generic meeting
 * sections are intentionally removed — when a user picks LPs to evaluate, that's the entire
 * scope of the report. The caller enforces exactly-2 at validation time.
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

这是一次 Leadership Principle 面试，本场**只考察两项 LP**：${lp1} 和 ${lp2}。报告只围绕这两项 LP 展开，不涉及的内容不要列出来。

按以下 JSON 输出：

{
  "meetingType": "interview",
  "interviewSubType": "lp",
  "interviewLPs": ${JSON.stringify(lps)},
  "summary": "2-3 句话总体评价（基于两项 LP 的综合表现）",
  "lpBlocks": [
    {
      "lp": ${JSON.stringify(lp1)},
      "rating": "strong | satisfactory | weak | not-assessed",
      "overview": "2-3 句针对 ${lp1} 的综合评估，说明候选人在该维度上的整体表现。",
      "evidence": [
        "支撑该评级的具体行为证据（保留项目名、数据、决策细节），每条一句话。"
      ],
      "qaList": [
        {
          "question": "面试官完整问题 — 主问 + 所有追问合并成一条完整的考察链。",
          "answer": "候选人完整回答的精炼整理（保留项目名、数据、时间线、具体行为），允许 2-5 句。",
          "assessment": "这条问答对 ${lp1} 维度的支撑度（强/中/弱）及原因。"
        }
      ]
    },
    {
      "lp": ${JSON.stringify(lp2)},
      "rating": "strong | satisfactory | weak | not-assessed",
      "overview": "2-3 句针对 ${lp2} 的综合评估。",
      "evidence": ["..."],
      "qaList": [
        {
          "question": "...",
          "answer": "...",
          "assessment": "这条问答对 ${lp2} 维度的支撑度。"
        }
      ]
    }
  ]
}

硬性要求：
1. lpBlocks 数组长度**必须恰好为 2**，lp 字段分别是 "${lp1}" 和 "${lp2}"，顺序一致。
2. 每个 lpBlock.qaList 要覆盖面试中与该 LP 相关的**每个考察主题**。主问+追问合并为一条，不要拆。
3. 跨 LP 的问答不要重复放到两个块里 —— 选择与哪个 LP 更相关的那一块。
4. 若某个 LP 在本场没被有效考察，对应块的 rating 填 "not-assessed"，overview 说明原因，evidence / qaList 可为空数组。
5. rating 必须基于 evidence，不得空泛。
6. **严禁输出 summary / lpBlocks / interviewLPs / meetingType / interviewSubType 之外的任何字段**（比如 candidateInfo、recommendation、redFlags、highlights、participants 等一律不要）。

转录文本：${transcriptText}

${JSON_ONLY}`;
}

module.exports = { buildPhonescreenPrompt, buildLpPrompt };
