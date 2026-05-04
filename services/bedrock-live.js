"use strict";

const {
  BedrockRuntimeClient,
  InvokeModelWithResponseStreamCommand,
} = require("@aws-sdk/client-bedrock-runtime");
const { extractJsonFromLLMResponse } = require("./report-builder");

const bedrockClient = new BedrockRuntimeClient({
  region: process.env.BEDROCK_REGION || process.env.AWS_REGION || "us-west-2",
});

const DEFAULT_MODEL_ID =
  process.env.BEDROCK_LIVE_MODEL_ID || "global.anthropic.claude-sonnet-4-6";

const TRUNCATE_MARKER = "\n\n[...transcript truncated...]\n\n";
const TRANSCRIPT_CHAR_LIMIT = 200_000;

function truncateTranscriptForLive(transcript, charLimit = TRANSCRIPT_CHAR_LIMIT) {
  if (!transcript || transcript.length <= charLimit) return transcript;
  const headLen = Math.floor(charLimit * 0.2);
  const tailLen = Math.floor(charLimit * 0.7);
  return transcript.slice(0, headLen) + TRUNCATE_MARKER + transcript.slice(-tailLen);
}

const SYSTEM_PROMPT =
  "You are a concise meeting assistant. You are shown a transcript of a meeting that is still in progress. " +
  "Produce a structured JSON summary in English. Do not fabricate content not supported by the transcript. " +
  "Output JSON only — no prose, no code fences.";

function templateForMeetingType(meetingType) {
  const base = {
    summary: "2-3 sentence overview of the meeting so far",
    highlights: [{ point: "short title", detail: "one sentence" }],
    lowlights: [{ point: "short title", detail: "one sentence" }],
    actions: [
      { task: "what to do", owner: "name or role", deadline: "if stated", priority: "high|medium|low" },
    ],
    decisions: [{ decision: "what was decided", rationale: "why" }],
  };

  const contextHint = meetingType
    ? {
        general: "This is a general meeting.",
        weekly: "This is a weekly team meeting; emphasize per-person updates and cross-project coordination.",
        tech: "This is a technical discussion; emphasize technical decisions and unresolved questions.",
        customer: "This is a customer meeting; emphasize customer asks, pain points, and AWS commitments.",
        interview: "This is an interview; emphasize signal on strengths, gaps, and a recommendation.",
      }[meetingType] || "This is a general meeting."
    : "This is a general meeting.";

  return (
    `${contextHint}\n\n` +
    `Output format (strict JSON, all strings in English):\n` +
    JSON.stringify(base, null, 2) +
    `\nReturn empty arrays for sections not yet discussed. Never omit a key.`
  );
}

function buildLivePrompt(transcriptText, { meetingType, elapsedSec } = {}) {
  const cachedTemplate = templateForMeetingType(meetingType);
  const elapsedNote = Number.isFinite(elapsedSec)
    ? `Meeting has been running for ${Math.round(elapsedSec / 60)} minute(s).\n\n`
    : "";
  const userPrompt = `${elapsedNote}Transcript (format: [HH:MM:SS] utterance):\n${transcriptText}`;
  return { systemPrompt: SYSTEM_PROMPT, cachedTemplate, userPrompt };
}

function classifyBedrockError(err) {
  if (!err) return { code: "INTERNAL", message: "unknown error" };
  const name = err.name || "";
  if (name === "AbortError") return { code: "BEDROCK_TIMEOUT", message: "Bedrock request timed out" };
  if (name === "ThrottlingException" || name === "ServiceUnavailableException") {
    return { code: "BEDROCK_UNAVAILABLE", message: "Bedrock is throttling or unavailable" };
  }
  return { code: "INTERNAL", message: err.message || "bedrock invocation failed" };
}

async function generateLiveSummary(transcriptText, opts = {}) {
  const truncated = truncateTranscriptForLive(transcriptText);
  const { systemPrompt, cachedTemplate, userPrompt } = buildLivePrompt(truncated, opts);

  const body = {
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: 8000,
    temperature: 0,
    system: [
      { type: "text", text: systemPrompt },
      { type: "text", text: cachedTemplate, cache_control: { type: "ephemeral" } },
    ],
    messages: [{ role: "user", content: [{ type: "text", text: userPrompt }] }],
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);

  let rawText;
  try {
    const resp = await bedrockClient.send(
      new InvokeModelWithResponseStreamCommand({
        modelId: opts.modelId || DEFAULT_MODEL_ID,
        contentType: "application/json",
        accept: "application/json",
        body: JSON.stringify(body),
      }),
      { abortSignal: controller.signal }
    );

    const parts = [];
    let tokensInput = 0;
    let tokensOutput = 0;
    for await (const event of resp.body) {
      if (event.throttlingException || event.serviceUnavailableException) {
        const e = new Error(
          event.throttlingException?.message ||
          event.serviceUnavailableException?.message ||
          "bedrock unavailable"
        );
        e.name = "ThrottlingException";
        throw e;
      }
      if (event.modelTimeoutException) {
        const e = new Error(event.modelTimeoutException.message || "bedrock model timeout");
        e.name = "AbortError";
        throw e;
      }
      if (event.internalServerException || event.modelStreamErrorException || event.validationException) {
        const msg =
          event.internalServerException?.message ||
          event.modelStreamErrorException?.message ||
          event.validationException?.message ||
          "bedrock stream error";
        throw new Error(msg);
      }
      if (!event.chunk?.bytes) continue;
      try {
        const evt = JSON.parse(new TextDecoder().decode(event.chunk.bytes));
        if (evt.type === "content_block_delta" && evt.delta?.text) parts.push(evt.delta.text);
        if (evt.type === "message_start" && evt.message?.usage) {
          tokensInput = evt.message.usage.input_tokens || 0;
        }
        if (evt.type === "message_delta" && evt.usage?.output_tokens) {
          tokensOutput = evt.usage.output_tokens;
        }
      } catch (_) {
        /* skip non-JSON chunk */
      }
    }
    rawText = parts.join("");

    let parsed;
    try {
      parsed = extractJsonFromLLMResponse(rawText);
    } catch (_e) {
      const parseErr = new Error(`Bedrock returned unparseable output: ${rawText.slice(0, 200)}`);
      parseErr.code = "INTERNAL";
      parseErr.__liveSummaryClassified = true;
      throw parseErr;
    }

    return {
      summary: parsed.summary || "",
      highlights: parsed.highlights || [],
      lowlights: parsed.lowlights || [],
      actions: parsed.actions || [],
      decisions: parsed.decisions || [],
      generatedAt: new Date().toISOString(),
      tokensInput,
      tokensOutput,
    };
  } catch (err) {
    if (err.__liveSummaryClassified) throw err;
    const classified = classifyBedrockError(err);
    const wrapped = new Error(classified.message);
    wrapped.code = classified.code;
    wrapped.__liveSummaryClassified = true;
    wrapped.cause = err;
    throw wrapped;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  truncateTranscriptForLive,
  buildLivePrompt,
  generateLiveSummary,
};
