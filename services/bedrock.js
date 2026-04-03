const {
  BedrockRuntimeClient,
  InvokeModelWithResponseStreamCommand,
} = require("@aws-sdk/client-bedrock-runtime");

const bedrockClient = new BedrockRuntimeClient({
  region: process.env.BEDROCK_REGION || process.env.AWS_REGION || "us-west-2",
});

const DEFAULT_MODEL_ID = process.env.BEDROCK_MODEL_ID || "global.anthropic.claude-opus-4-6-v1";

function getMeetingPrompt(transcriptText, meetingType, glossaryTerms = [], speakerMap = null, customPrompt = null) {
  let speakerNote = "";
  if (speakerMap && Object.keys(speakerMap).length > 0) {
    const mapping = Object.entries(speakerMap).map(([k, v]) => `${k}: ${v}`).join(", ");
    const nameList = [...new Set(Object.values(speakerMap))].join("、");
    speakerNote = `以下是参会人真实姓名映射，请在纪要中使用真实姓名：{${mapping}}\n\n重要：只允许使用以上真实姓名（${nameList}），严禁使用"成员A"、"成员B"、"成员C"、"成员D"、"主持人"等匿名代号。所有提及参会人的地方必须使用映射中的真实姓名。\n\n同时，请在 JSON 输出的 speakerKeypoints 字段中，为每位说话人提取最多3条核心发言要点。每条要点必须至少80个中文字，完整描述该说话人的具体观点、提出的数据/方案和上下文背景，不要只写一句话摘要。\n\n`;
  } else if (transcriptText.includes("[SPEAKER_")) {
    speakerNote = `转录文本中包含说话人标签（如 [SPEAKER_0]、[SPEAKER_1]），请根据每位说话人的发言内容、语气和角色推断其身份（如"主持人"、"成员A"、"客户代表"等），在纪要中使用推断的角色名称而非 SPEAKER_X 编号。若无法推断具体身份，可使用"成员A/B/C"等匿名标注。\n\n同时，请在 JSON 输出的 speakerKeypoints 字段中，为每位说话人（SPEAKER_0、SPEAKER_1 等）提取最多3条核心发言要点。每条要点必须至少80个中文字，完整描述该说话人的具体观点、提出的数据/方案和上下文背景，不要只写一句话摘要。\n\n`;
  }

  const glossaryNote = glossaryTerms.length > 0
    ? `专有名词词库（请确保报告中使用正确拼写）：${glossaryTerms.join("、")}\n\n`
    : "";

  if (meetingType === "merged") {
    const customNote = customPrompt
      ? `用户额外要求：${customPrompt}\n\n`
      : "";
    return `${customNote}${glossaryNote}你是专业会议纪要助手，请根据以下多份会议纪要内容，生成一份综合汇总报告。

会议纪要内容：
${transcriptText}

以 JSON 格式输出：
{
  "meetingType": "merged",
  "summary": "跨会议综合总结（3-5句话）",
  "keyTopics": [{ "topic": "主题", "detail": "分析", "source": "来源会议" }],
  "highlights": [{ "point": "亮点", "detail": "详情", "source": "来源会议" }],
  "lowlights": [{ "point": "问题/风险", "detail": "详情", "source": "来源会议" }],
  "actions": [{ "task": "行动项", "owner": "负责人", "deadline": "截止日期", "priority": "high/medium/low", "source": "来源会议" }],
  "decisions": [{ "decision": "决策", "rationale": "原因", "source": "来源会议" }],
  "risks": [{ "risk": "风险", "impact": "影响", "mitigation": "措施" }],
  "participants": ["跨会议参与人汇总"],
  "sourceMeetings": ["会议标题列表"],
  "speakerKeypoints": {}
}
只输出 JSON。`;
  }

  if (meetingType === "weekly") {
    return `${speakerNote}${glossaryNote}你是专业会议纪要助手，请分析以下 AWS SA 团队周例会转录文本，生成结构化会议纪要。周例会通常包含三大部分：团队/个人 KPI 汇报、公司公告事项、客户/项目逐个 Review。请注意：若 teamKPI 或 announcements 部分在转录中未明确提及，对应字段输出空数组即可，不要编造内容。每个项目/客户单独作为一个 projectReviews 条目，若会议中多人分别汇报不同项目，请逐项拆分，不要合并为一条。

转录文本：${transcriptText}

以 JSON 格式输出：
{
  "meetingType": "weekly",
  "summary": "本次周会总结（2-3句话，涵盖整体氛围和最重要结论）",
  "teamKPI": {
    "overview": "团队整体 KPI 完成情况概述",
    "individuals": [
      { "name": "负责人姓名或角色（如主持人、成员A）", "kpi": "个人 KPI 要点", "status": "on-track / at-risk / completed" }
    ]
  },
  "announcements": [
    { "title": "公告标题", "detail": "公告内容", "owner": "发布人（如提及）" }
  ],
  "projectReviews": [
    {
      "project": "项目/客户名称",
      "progress": "本周进展概述",
      "followUps": [
        { "task": "待跟进事项", "owner": "负责人姓名或角色（如主持人、成员A）", "deadline": "截止时间（如提及）", "status": "new / in-progress / blocked" }
      ],
      "highlights": [{ "point": "亮点", "detail": "详情" }],
      "lowlights": [{ "point": "问题或未达预期", "detail": "影响" }],
      "risks": [{ "risk": "风险描述", "impact": "high / medium / low", "mitigation": "缓解措施或应对方向" }],
      "challenges": [{ "challenge": "挑战", "detail": "背景和当前状态" }]
    }
  ],
  "decisions": [
    { "decision": "决策内容", "rationale": "决策原因", "owner": "决策人（如提及）" }
  ],
  "actions": [
    { "task": "行动项", "owner": "负责人姓名或角色（如主持人、成员A）", "deadline": "截止日期（如提及）", "priority": "high / medium / low", "project": "关联项目（如有）" }
  ],
  "participants": ["发言人角色（如主持人、成员A、客户代表）"],
  "highlights": [{ "point": "亮点", "detail": "详情" }],
  "lowlights": [{ "point": "问题/风险", "detail": "详情" }],
  "nextMeeting": "下次会议时间（如有提及）",
  "speakerKeypoints": {
    "SPEAKER_0": ["该说话人提出的完整观点，包括具体数据、方案细节和上下文背景，每条至少50个中文字"],
    "SPEAKER_1": ["该说话人提出的完整观点，包括具体数据、方案细节和上下文背景，每条至少50个中文字"]
  }
}
只输出 JSON。`;
  }

  if (meetingType === "tech") {
    return `${speakerNote}${glossaryNote}你是专业技术会议纪要助手，请分析以下技术讨论会转录文本，生成结构化技术会议纪要。

转录文本：${transcriptText}

以 JSON 格式输出：
{
  "meetingType": "tech",
  "summary": "技术讨论总结（2-3句话）",
  "topics": [{ "topic": "技术议题", "discussion": "讨论要点", "conclusion": "结论" }],
  "highlights": [{ "point": "技术亮点/分享要点", "detail": "详情" }],
  "lowlights": [{ "point": "技术风险/Trade-off", "detail": "影响分析" }],
  "actions": [{ "task": "技术任务", "owner": "负责人", "deadline": "截止日期", "priority": "high/medium/low", "estimate": "工时估计" }],
  "knowledgeBase": [{ "title": "知识点标题", "content": "可直接用于文档的技术总结" }],
  "participants": ["参会人列表"],
  "decisions": [{ "decision": "决策内容", "rationale": "决策原因" }],
  "techStack": ["涉及的技术/工具/框架"],
  "speakerKeypoints": {
    "SPEAKER_0": ["该说话人提出的完整观点，包括具体数据、方案细节和上下文背景，每条至少50个中文字"],
    "SPEAKER_1": ["该说话人提出的完整观点，包括具体数据、方案细节和上下文背景，每条至少50个中文字"]
  }
}
只输出 JSON。`;
  }

  if (meetingType === "customer") {
    return `${speakerNote}${glossaryNote}你是专业的 AWS SA 会议纪要助手，请分析以下客户会议转录文本，生成结构化客户会议纪要。

请严格输出以下 JSON 格式，不要包含任何额外文字：

{
  "meetingType": "customer",
  "date": "会议日期（如转录中提及）",
  "duration": "会议时长（如可推断）",
  "summary": "2-3句话概括本次会议核心内容和结论",
  "customerInfo": {
    "company": "客户公司名称",
    "attendees": ["客户参会人（姓名/职位）"]
  },
  "awsAttendees": ["AWS 参会人（姓名/职位）"],
  "customerNeeds": [
    {
      "need": "客户需求描述",
      "priority": "high / medium / low",
      "background": "背景说明（如有）"
    }
  ],
  "painPoints": [
    {
      "point": "客户痛点",
      "detail": "详细说明"
    }
  ],
  "solutionsDiscussed": [
    {
      "solution": "讨论的解决方案",
      "awsServices": ["涉及的 AWS 服务"],
      "customerFeedback": "客户反馈/态度"
    }
  ],
  "commitments": [
    {
      "party": "AWS / 客户",
      "commitment": "承诺内容",
      "owner": "负责人",
      "deadline": "截止时间（如提及）"
    }
  ],
  "nextSteps": [
    {
      "task": "下一步行动",
      "owner": "负责人",
      "deadline": "截止日期",
      "priority": "high / medium / low"
    }
  ],
  "participants": ["所有参会人员"],
  "highlights": [{ "point": "亮点", "detail": "详情" }],
  "lowlights": [{ "point": "问题/风险", "detail": "详情" }],
  "actions": [{ "task": "行动项", "owner": "负责人", "deadline": "截止日期", "priority": "high/medium/low" }],
  "decisions": [{ "decision": "决策内容", "rationale": "决策原因" }],
  "speakerKeypoints": {
    "SPEAKER_0": ["该说话人提出的完整观点，包括具体数据、方案细节和上下文背景，每条至少50个中文字"],
    "SPEAKER_1": ["该说话人提出的完整观点，包括具体数据、方案细节和上下文背景，每条至少50个中文字"]
  }
}

转录文本：${transcriptText}

注意：speakerKeypoints 字段仅当转录文本中包含 [SPEAKER_X] 标签时提取，每位说话人最多3条核心发言要点，每条至少50个中文字。若无说话人标签，则输出空对象 {}。只输出 JSON。`;
  }

  // general (default)
  return `${speakerNote}${glossaryNote}你是一个专业的会议纪要助手。请分析以下会议转录文本，生成结构化的会议纪要。

转录文本：
${transcriptText}

请以 JSON 格式输出，包含以下字段：
{
  "meetingType": "general",
  "summary": "会议总结（2-3句话）",
  "agenda": ["议程项（如提及）"],
  "topics": [{ "topic": "议题", "discussion": "讨论要点", "conclusion": "结论或待定" }],
  "highlights": [{ "point": "要点描述", "detail": "详情" }],
  "lowlights": [{ "point": "风险/问题描述", "detail": "详情" }],
  "decisions": [{ "decision": "决策内容", "rationale": "决策原因", "owner": "决策人（如提及）" }],
  "actions": [{ "task": "任务描述", "owner": "负责人", "deadline": "截止日期（如提及）", "priority": "high/medium/low" }],
  "risks": [{ "risk": "风险描述", "impact": "high/medium/low", "mitigation": "缓解方向" }],
  "participants": ["发言人角色"],
  "nextMeeting": "下次会议时间（如有提及）",
  "speakerKeypoints": {
    "SPEAKER_0": ["该说话人提出的完整观点，包括具体数据、方案细节和上下文背景，每条至少50个中文字"],
    "SPEAKER_1": ["该说话人提出的完整观点，包括具体数据、方案细节和上下文背景，每条至少50个中文字"]
  }
}

只输出 JSON，不要其他文字。`;
}

function truncateTranscript(text) {
  const MAX_TOTAL = 700000;  // Opus 4.6 native 1M context (~930K tokens input budget)
  const MAX_EACH = 350000;

  // FunASR-only: truncate content portion
  if (text.includes("[FunASR 转录（含说话人标签）]")) {
    const FUNASR_LABEL = "[FunASR 转录（含说话人标签）]";
    const idx = text.indexOf(FUNASR_LABEL);
    const before = text.slice(0, idx);
    const after = text.slice(idx + FUNASR_LABEL.length);
    return before + FUNASR_LABEL + after.slice(0, MAX_EACH);
  }

  return text.slice(0, MAX_TOTAL);
}

/**
 * Low-level Bedrock streaming call. Accepts any system/user prompt pair and returns raw text.
 * Used by chunked generation (report-chunked.js) for phase-by-phase report building.
 */
async function invokeModelRaw(systemPrompt, userPrompt, { maxTokens = 16000, modelId = DEFAULT_MODEL_ID } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 600_000);
  let resp;
  try {
    resp = await bedrockClient.send(
      new InvokeModelWithResponseStreamCommand({
        modelId,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: maxTokens,
          temperature: 0,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        }),
      }),
      { abortSignal: controller.signal }
    );

    const textParts = [];
    for await (const event of resp.body) {
      if (event.chunk?.bytes) {
        try {
          const evt = JSON.parse(new TextDecoder().decode(event.chunk.bytes));
          if (evt.type === 'content_block_delta' && evt.delta?.text) {
            textParts.push(evt.delta.text);
          }
        } catch (_) { /* skip non-JSON or partial chunks */ }
      }
    }
    return textParts.join('');
  } finally {
    clearTimeout(timeout);
  }
}

async function invokeModel(transcriptText, meetingType = "general", glossaryTerms = [], modelId = DEFAULT_MODEL_ID, speakerMap = null, customPrompt = null) {
  const truncated = truncateTranscript(transcriptText);
  const prompt = getMeetingPrompt(truncated, meetingType, glossaryTerms, speakerMap, customPrompt);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1_800_000); // 30 min
  let resp;
  try {
    resp = await bedrockClient.send(
      new InvokeModelWithResponseStreamCommand({
        modelId,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: 64000,
          temperature: 0,
          system: '你是专业会议纪要助手。严格基于转录文本中的内容生成报告，不要编造或推测任何未在转录中出现的信息。每个 JSON 字段值必须语义完整、独立。',
          messages: [{ role: 'user', content: prompt }],
        }),
      }),
      { abortSignal: controller.signal }
    );

    const textParts = [];
    for await (const event of resp.body) {
      if (event.chunk?.bytes) {
        try {
          const evt = JSON.parse(new TextDecoder().decode(event.chunk.bytes));
          if (evt.type === 'content_block_delta' && evt.delta?.text) {
            textParts.push(evt.delta.text);
          }
        } catch (_) { /* skip non-JSON or partial chunks */ }
      }
    }
    return textParts.join('');
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { invokeModel, invokeModelRaw, getMeetingPrompt };
