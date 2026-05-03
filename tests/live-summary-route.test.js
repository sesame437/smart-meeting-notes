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

  test("returns 501 NOT_IMPLEMENTED when body is valid (pre-implementation)", async () => {
    const app = buildApp();
    const res = await request(app).post("/api/live-summary").send({
      sessionId: "3f2a0a12-0000-4000-8000-000000000000",
      transcriptText: "hello",
      elapsedSec: 10,
    });
    expect(res.status).toBe(501);
    expect(res.body.error.code).toBe("NOT_IMPLEMENTED");
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
