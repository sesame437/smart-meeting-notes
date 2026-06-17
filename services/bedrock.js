"use strict";

const {
  BedrockRuntimeClient,
  InvokeModelWithResponseStreamCommand,
} = require("@aws-sdk/client-bedrock-runtime");
const { getMeetingPrompt } = require("./prompts");

const bedrockClient = new BedrockRuntimeClient({
  region: process.env.BEDROCK_REGION || process.env.AWS_REGION || "us-west-2",
});

const DEFAULT_MODEL_ID = process.env.BEDROCK_MODEL_ID || "global.anthropic.claude-opus-4-6-v1";

const SYSTEM_PROMPT = "你是专业会议纪要助手。严格基于转录文本中的内容生成报告，不要编造或推测任何未在转录中出现的信息。每个 JSON 字段值必须语义完整、独立。";

function truncateTranscript(text) {
  const MAX_TOTAL = 700000;
  const MAX_EACH = 350000;

  if (text.includes("[FunASR 转录（含说话人标签）]")) {
    const FUNASR_LABEL = "[FunASR 转录（含说话人标签）]";
    const idx = text.indexOf(FUNASR_LABEL);
    const before = text.slice(0, idx);
    const after = text.slice(idx + FUNASR_LABEL.length);
    return before + FUNASR_LABEL + after.slice(0, MAX_EACH);
  }

  return text.slice(0, MAX_TOTAL);
}

async function streamResponse(resp) {
  const textParts = [];
  for await (const event of resp.body) {
    if (event.chunk?.bytes) {
      try {
        const evt = JSON.parse(new TextDecoder().decode(event.chunk.bytes));
        if (evt.type === "content_block_delta" && evt.delta?.text) {
          textParts.push(evt.delta.text);
        }
      } catch (_) { /* skip non-JSON or partial chunks */ }
    }
  }
  return textParts.join("");
}

/**
 * Low-level Bedrock streaming call. Accepts any system/user prompt pair and returns raw text.
 * Used by chunked generation (report-chunked.js) for phase-by-phase report building.
 */
async function invokeModelRaw(systemPrompt, userPrompt, { maxTokens = 16000, modelId = DEFAULT_MODEL_ID } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 600_000);
  try {
    const resp = await bedrockClient.send(
      new InvokeModelWithResponseStreamCommand({
        modelId,
        contentType: "application/json",
        accept: "application/json",
        body: JSON.stringify({
          anthropic_version: "bedrock-2023-05-31",
          max_tokens: maxTokens,
          temperature: 0,
          system: systemPrompt,
          messages: [{ role: "user", content: userPrompt }],
        }),
      }),
      { abortSignal: controller.signal }
    );
    return await streamResponse(resp);
  } finally {
    clearTimeout(timeout);
  }
}

async function invokeModel(transcriptText, meetingType = "general", glossaryTerms = [], modelId = DEFAULT_MODEL_ID, speakerMap = null, customPrompt = null, extraOpts = null) {
  const truncated = truncateTranscript(transcriptText);
  const prompt = getMeetingPrompt(truncated, meetingType, glossaryTerms, speakerMap, customPrompt, extraOpts);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1_800_000);
  try {
    const resp = await bedrockClient.send(
      new InvokeModelWithResponseStreamCommand({
        modelId,
        contentType: "application/json",
        accept: "application/json",
        body: JSON.stringify({
          anthropic_version: "bedrock-2023-05-31",
          max_tokens: 64000,
          temperature: 0,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: prompt }],
        }),
      }),
      { abortSignal: controller.signal }
    );
    return await streamResponse(resp);
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { invokeModel, invokeModelRaw, getMeetingPrompt };
