"use strict";

const express = require("express");
const request = require("supertest");

function buildApp() {
  const app = express();
  app.use(express.json());
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
});
