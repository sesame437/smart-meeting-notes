"use strict";

const mockSend = jest.fn();

function makeStreamBody(jsonText, usage = null) {
  const messageStart = {
    type: "message_start",
    message: { id: "msg_test", type: "message", role: "assistant", content: [] },
  };
  if (usage?.inputTokens !== undefined) {
    messageStart.message.usage = { input_tokens: usage.inputTokens };
  }
  const events = [
    messageStart,
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: jsonText } },
  ];
  if (usage?.outputTokens !== undefined) {
    events.push({ type: "message_delta", delta: {}, usage: { output_tokens: usage.outputTokens } });
  }
  events.push({ type: "message_stop" });
  return {
    body: {
      async *[Symbol.asyncIterator]() {
        for (const evt of events) {
          yield { chunk: { bytes: new TextEncoder().encode(JSON.stringify(evt)) } };
        }
      },
    },
  };
}

jest.mock("@aws-sdk/client-bedrock-runtime", () => ({
  BedrockRuntimeClient: jest.fn().mockImplementation(() => ({ send: mockSend })),
  InvokeModelWithResponseStreamCommand: jest.fn((input) => ({ input })),
}));

const { truncateTranscriptForLive } = require("../services/bedrock-live");

describe("truncateTranscriptForLive", () => {
  test("passes short transcript through unchanged", () => {
    const input = "[00:00:05] hello\n[00:00:10] world\n";
    expect(truncateTranscriptForLive(input, 1000)).toBe(input);
  });

  test("truncates to head 20% + tail 70% of limit when over limit", () => {
    const input = "x".repeat(10_000);
    const limit = 1000;
    const out = truncateTranscriptForLive(input, limit);
    expect(out).toContain("[...transcript truncated...]");
    expect(out.length).toBeLessThanOrEqual(limit + "[...transcript truncated...]".length + 10);
    // Roughly head 200 + tail 700 = 900 chars of real content
    expect(out.startsWith("x".repeat(200))).toBe(true);
    expect(out.endsWith("x".repeat(700))).toBe(true);
  });

  test("keeps middle content verbatim when exactly at limit", () => {
    const input = "x".repeat(1000);
    expect(truncateTranscriptForLive(input, 1000)).toBe(input);
  });

  test("returns empty string unchanged", () => {
    expect(truncateTranscriptForLive("", 100)).toBe("");
  });
});

describe("buildLivePrompt", () => {
  const { buildLivePrompt } = require("../services/bedrock-live");

  test("includes transcript text in user prompt", () => {
    const { userPrompt } = buildLivePrompt("[00:00:05] hello", { meetingType: "general", elapsedSec: 60 });
    expect(userPrompt).toContain("[00:00:05] hello");
  });

  test("system prompt instructs English-only JSON output", () => {
    const { systemPrompt } = buildLivePrompt("hi", { meetingType: "general", elapsedSec: 60 });
    expect(systemPrompt).toMatch(/English/);
    expect(systemPrompt).toMatch(/JSON/);
  });

  test("meetingType=weekly injects weekly-specific hint", () => {
    const { cachedTemplate } = buildLivePrompt("hi", { meetingType: "weekly", elapsedSec: 60 });
    expect(cachedTemplate).toMatch(/weekly/i);
  });

  test("omits meetingType produces generic template", () => {
    const { cachedTemplate } = buildLivePrompt("hi", { elapsedSec: 60 });
    expect(cachedTemplate).toMatch(/meeting/i);
    expect(cachedTemplate).not.toMatch(/weekly/i);
  });
});

describe("generateLiveSummary", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const { generateLiveSummary } = require("../services/bedrock-live");

  test("returns parsed summary object on happy path", async () => {
    const sampleReturn = JSON.stringify({
      summary: "Team discussed Q3 roadmap.",
      highlights: [{ point: "Roadmap locked", detail: "PM signed off" }],
      lowlights: [],
      actions: [{ task: "Ship feature X", owner: "Alice", deadline: "5/10", priority: "high" }],
      decisions: [{ decision: "Delay launch", rationale: "QA needs time" }],
    });
    mockSend.mockResolvedValueOnce(makeStreamBody(sampleReturn));

    const result = await generateLiveSummary("[00:00:05] hello", { elapsedSec: 60 });

    expect(result.summary).toBe("Team discussed Q3 roadmap.");
    expect(result.highlights).toHaveLength(1);
    expect(result.actions[0].owner).toBe("Alice");
    expect(result.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("sends cache_control on system + template prefix", async () => {
    mockSend.mockResolvedValueOnce(makeStreamBody('{"summary":"","highlights":[],"lowlights":[],"actions":[],"decisions":[]}'));

    await generateLiveSummary("hello", { elapsedSec: 60 });

    const commandArg = mockSend.mock.calls[0][0].input;
    const body = JSON.parse(commandArg.body);
    expect(Array.isArray(body.system)).toBe(true);
    expect(body.system).toHaveLength(2);
    expect(body.system[0].cache_control).toBeUndefined();
    expect(body.system[1].cache_control?.type).toBe("ephemeral");
  });

  test("throws BEDROCK_TIMEOUT when client aborts", async () => {
    mockSend.mockRejectedValueOnce(Object.assign(new Error("aborted"), { name: "AbortError" }));
    await expect(generateLiveSummary("hi", { elapsedSec: 60 })).rejects.toMatchObject({
      code: "BEDROCK_TIMEOUT",
    });
  });

  test("throws BEDROCK_UNAVAILABLE on throttle", async () => {
    mockSend.mockRejectedValueOnce(Object.assign(new Error("throttled"), { name: "ThrottlingException" }));
    await expect(generateLiveSummary("hi", { elapsedSec: 60 })).rejects.toMatchObject({
      code: "BEDROCK_UNAVAILABLE",
    });
  });

  test("throws INTERNAL when model returns non-JSON", async () => {
    mockSend.mockResolvedValueOnce(makeStreamBody("not json at all"));
    await expect(generateLiveSummary("hi", { elapsedSec: 60 })).rejects.toMatchObject({
      code: "INTERNAL",
    });
  });

  test("extracts input/output tokens from usage events", async () => {
    const sample = JSON.stringify({
      summary: "", highlights: [], lowlights: [], actions: [], decisions: [],
    });
    mockSend.mockResolvedValueOnce(makeStreamBody(sample, { inputTokens: 123, outputTokens: 45 }));
    const result = await generateLiveSummary("x", { elapsedSec: 60 });
    expect(result.tokensInput).toBe(123);
    expect(result.tokensOutput).toBe(45);
  });

  test("maps mid-stream throttlingException to BEDROCK_UNAVAILABLE", async () => {
    mockSend.mockResolvedValueOnce({
      body: {
        async *[Symbol.asyncIterator]() {
          yield { throttlingException: { message: "too many requests" } };
        },
      },
    });
    await expect(generateLiveSummary("hi", { elapsedSec: 60 })).rejects.toMatchObject({
      code: "BEDROCK_UNAVAILABLE",
    });
  });

  test("parses JSON wrapped in markdown code fence", async () => {
    const inner = JSON.stringify({
      summary: "fence test",
      highlights: [], lowlights: [], actions: [], decisions: [],
    });
    const fenced = "```json\n" + inner + "\n```";
    mockSend.mockResolvedValueOnce(makeStreamBody(fenced));
    const result = await generateLiveSummary("x", { elapsedSec: 60 });
    expect(result.summary).toBe("fence test");
  });

  test("parses JSON with leading prose when code fence present", async () => {
    const inner = JSON.stringify({
      summary: "leading prose test",
      highlights: [], lowlights: [], actions: [], decisions: [],
    });
    const noisy = "Sure, here is the summary:\n\n```json\n" + inner + "\n```\nLet me know if you need changes.";
    mockSend.mockResolvedValueOnce(makeStreamBody(noisy));
    const result = await generateLiveSummary("x", { elapsedSec: 60 });
    expect(result.summary).toBe("leading prose test");
  });

  test("rejects malformed Bedrock output when highlights is not an array", async () => {
    const malformed = JSON.stringify({
      summary: "ok",
      highlights: "not-an-array",
      lowlights: [],
      actions: [],
      decisions: [],
    });
    mockSend.mockResolvedValueOnce(makeStreamBody(malformed));
    await expect(generateLiveSummary("x", { elapsedSec: 60 })).rejects.toMatchObject({
      code: "INTERNAL",
    });
  });

  test("rejects malformed Bedrock output when summary is not a string", async () => {
    const malformed = JSON.stringify({
      summary: { nested: "object" },
      highlights: [],
      lowlights: [],
      actions: [],
      decisions: [],
    });
    mockSend.mockResolvedValueOnce(makeStreamBody(malformed));
    await expect(generateLiveSummary("x", { elapsedSec: 60 })).rejects.toMatchObject({
      code: "INTERNAL",
    });
  });

  test("rejects malformed Bedrock output when action item is missing required task field", async () => {
    const malformed = JSON.stringify({
      summary: "ok",
      highlights: [],
      lowlights: [],
      actions: [{ owner: "Alice", priority: "high" }],
      decisions: [],
    });
    mockSend.mockResolvedValueOnce(makeStreamBody(malformed));
    await expect(generateLiveSummary("x", { elapsedSec: 60 })).rejects.toMatchObject({
      code: "INTERNAL",
    });
  });
});
