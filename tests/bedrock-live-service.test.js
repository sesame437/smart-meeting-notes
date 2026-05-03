"use strict";

const mockSend = jest.fn();

function makeStreamBody(jsonText) {
  const events = [
    { type: "message_start", message: { id: "msg_test", type: "message", role: "assistant" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: jsonText } },
    { type: "message_stop" },
  ];
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
    const cached = body.system.find((b) => b.cache_control?.type === "ephemeral");
    expect(cached).toBeDefined();
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
});
