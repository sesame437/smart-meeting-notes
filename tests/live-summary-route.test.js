"use strict";

const express = require("express");
const request = require("supertest");

function buildApp() {
  const app = express();
  // Use 300kb limit so the 200_001-char test body reaches zod validation (Express default is 100kb).
  app.use(express.json({ limit: "300kb" }));
  const liveSummaryRouter = require("../routes/live-summary");
  app.use("/api/live-summary", liveSummaryRouter);
  return app;
}

describe("POST /api/live-summary validation", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test("returns 400 VALIDATION_ERROR when body is empty", async () => {
    const app = buildApp();
    const res = await request(app).post("/api/live-summary").send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  test("passes validation and reaches service layer for a valid body", async () => {
    // Mock the service so the test is isolated from Bedrock.
    jest.doMock("../services/bedrock-live", () => ({
      generateLiveSummary: jest.fn().mockResolvedValue({
        summary: "hi",
        highlights: [],
        lowlights: [],
        actions: [],
        decisions: [],
        generatedAt: "2026-05-03T00:00:00.000Z",
        tokensInput: 1,
        tokensOutput: 1,
      }),
    }));
    const app = buildApp();
    const res = await request(app).post("/api/live-summary").send({
      sessionId: "3f2a0a12-0000-4000-8000-000000000000",
      transcriptText: "hello",
      elapsedSec: 10,
    });
    expect(res.status).toBe(200);
  });

  test("rejects non-UUID sessionId", async () => {
    const app = buildApp();
    const res = await request(app).post("/api/live-summary").send({
      sessionId: "not-a-uuid",
      transcriptText: "hello",
      elapsedSec: 10,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.message).toMatch(/sessionId/);
  });

  test("rejects transcriptText longer than 200000 chars", async () => {
    const app = buildApp();
    const res = await request(app).post("/api/live-summary").send({
      sessionId: "3f2a0a12-0000-4000-8000-000000000000",
      transcriptText: "x".repeat(200_001),
      elapsedSec: 10,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  test("rejects empty transcriptText", async () => {
    const app = buildApp();
    const res = await request(app).post("/api/live-summary").send({
      sessionId: "3f2a0a12-0000-4000-8000-000000000000",
      transcriptText: "",
      elapsedSec: 10,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  test("rejects zero or negative elapsedSec", async () => {
    const app = buildApp();
    const res = await request(app).post("/api/live-summary").send({
      sessionId: "3f2a0a12-0000-4000-8000-000000000000",
      transcriptText: "hello",
      elapsedSec: 0,
    });
    expect(res.status).toBe(400);
  });

  test("rejects unknown meetingType", async () => {
    const app = buildApp();
    const res = await request(app).post("/api/live-summary").send({
      sessionId: "3f2a0a12-0000-4000-8000-000000000000",
      transcriptText: "hello",
      elapsedSec: 10,
      meetingType: "bogus",
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/live-summary rate limiting", () => {
  const mockSummary = {
    summary: "ok",
    highlights: [],
    lowlights: [],
    actions: [],
    decisions: [],
    generatedAt: "2026-05-03T00:00:00.000Z",
    tokensInput: 10,
    tokensOutput: 5,
  };

  beforeEach(() => {
    jest.resetModules();
    // Route module holds rate-limit state in memory; resetModules gives each test a fresh Map.
    jest.doMock("../services/bedrock-live", () => ({
      generateLiveSummary: jest.fn().mockResolvedValue(mockSummary),
    }));
  });

  const validBody = {
    sessionId: "3f2a0a12-0000-4000-8000-000000000001",
    transcriptText: "hello",
    elapsedSec: 10,
  };

  test("second call within 60s for same sessionId returns 429", async () => {
    const app = buildApp();
    const res1 = await request(app).post("/api/live-summary").send(validBody);
    expect(res1.status).toBe(200); // first call succeeds
    const res2 = await request(app).post("/api/live-summary").send(validBody);
    expect(res2.status).toBe(429);
    expect(res2.body.error.code).toBe("RATE_LIMITED");
  });

  test("second call with isFinal:true bypasses the limit", async () => {
    const app = buildApp();
    const res1 = await request(app).post("/api/live-summary").send(validBody);
    expect(res1.status).toBe(200);
    const res2 = await request(app)
      .post("/api/live-summary")
      .send({ ...validBody, isFinal: true });
    expect(res2.status).toBe(200); // bypassed rate limit, reaches handler
  });

  test("different sessionIds are not coupled", async () => {
    const app = buildApp();
    const res1 = await request(app).post("/api/live-summary").send(validBody);
    expect(res1.status).toBe(200);
    const res2 = await request(app).post("/api/live-summary").send({
      ...validBody,
      sessionId: "3f2a0a12-0000-4000-8000-000000000002",
    });
    expect(res2.status).toBe(200);
  });
});

describe("POST /api/live-summary integration", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.doMock("../services/bedrock-live", () => ({
      generateLiveSummary: jest.fn(),
    }));
  });

  const baseBody = {
    sessionId: "3f2a0a12-0000-4000-8000-00000000abcd",
    transcriptText: "[00:00:05] hello team",
    elapsedSec: 60,
  };

  test("returns 200 with structured summary on happy path", async () => {
    const { generateLiveSummary } = require("../services/bedrock-live");
    generateLiveSummary.mockResolvedValueOnce({
      summary: "hi",
      highlights: [],
      lowlights: [],
      actions: [],
      decisions: [],
      generatedAt: "2026-05-03T00:00:00.000Z",
      tokensInput: 100,
      tokensOutput: 50,
    });

    const app = buildApp();
    const res = await request(app).post("/api/live-summary").send(baseBody);
    expect(res.status).toBe(200);
    expect(res.body.summary).toBe("hi");
    expect(res.body.generatedAt).toMatch(/2026/);
    expect(generateLiveSummary).toHaveBeenCalledWith(
      baseBody.transcriptText,
      expect.objectContaining({ elapsedSec: 60 })
    );
  });

  test("maps BEDROCK_TIMEOUT error to 504", async () => {
    const { generateLiveSummary } = require("../services/bedrock-live");
    const err = new Error("timed out");
    err.code = "BEDROCK_TIMEOUT";
    generateLiveSummary.mockRejectedValueOnce(err);

    const app = buildApp();
    const res = await request(app).post("/api/live-summary").send(baseBody);
    expect(res.status).toBe(504);
    expect(res.body.error.code).toBe("BEDROCK_TIMEOUT");
  });

  test("maps BEDROCK_UNAVAILABLE error to 503", async () => {
    const { generateLiveSummary } = require("../services/bedrock-live");
    const err = new Error("throttled");
    err.code = "BEDROCK_UNAVAILABLE";
    generateLiveSummary.mockRejectedValueOnce(err);

    const app = buildApp();
    const res = await request(app).post("/api/live-summary").send(baseBody);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("BEDROCK_UNAVAILABLE");
  });

  test("maps unknown error to 500 INTERNAL", async () => {
    const { generateLiveSummary } = require("../services/bedrock-live");
    generateLiveSummary.mockRejectedValueOnce(new Error("boom"));

    const app = buildApp();
    const res = await request(app).post("/api/live-summary").send(baseBody);
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe("INTERNAL");
  });
});
