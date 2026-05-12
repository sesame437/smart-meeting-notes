"use strict";

const mockInvokeModel = jest.fn().mockResolvedValue(JSON.stringify({
  meetingType: "interview",
  interviewSubType: "lp",
  summary: "ok",
  candidateInfo: { name: "A" },
  lpBlocks: [
    { lp: "Ownership", qaList: [{ question: "q", answer: "a", assessment: "x" }] },
    { lp: "Dive Deep", qaList: [{ question: "q", answer: "a", assessment: "x" }] },
  ],
  redFlags: [],
  recommendation: { decision: "hire", reasoning: "r" },
  participants: [], highlights: [], lowlights: [], actions: [], decisions: [], speakerKeypoints: {},
}));

jest.mock("../services/bedrock", () => ({
  invokeModel: mockInvokeModel,
  invokeModelRaw: jest.fn(),
  getMeetingPrompt: jest.fn(),
  generateReportChunked: jest.fn(),
}));

jest.mock("../services/glossary-store", () => ({
  listGlossary: jest.fn().mockResolvedValue([]),
}));

jest.mock("../services/glossary-filter", () => ({
  filterGlossaryByMeetingType: jest.fn((items) => items),
}));

// S3: getFile returns a readable stream with parseable JSON (FunASR format)
jest.mock("../services/s3", () => ({
  uploadFile: jest.fn().mockResolvedValue(true),
  getFile: jest.fn().mockImplementation(() => {
    const { Readable } = require("stream");
    const data = JSON.stringify({ segments: [{ speaker: 0, text: "hello" }] });
    return Readable.from([Buffer.from(data)]);
  }),
}));

const mockQueryMeetingById = jest.fn();
jest.mock("../services/meeting-store", () => ({
  queryMeetingById: (...args) => mockQueryMeetingById(...args),
  updateMeetingReport: jest.fn().mockResolvedValue({}),
  saveReport: jest.fn().mockResolvedValue({}),
}));

// Mock sqs (required by routes/meetings/index -> core)
jest.mock("../services/sqs", () => ({
  sendMessage: jest.fn().mockResolvedValue({}),
}));

// Mock multer (required by helpers.js via core route)
jest.mock("multer", () => {
  const m = () => ({ single: () => (_req, _res, next) => next(), array: () => (_req, _res, next) => next() });
  m.diskStorage = jest.fn();
  return m;
});

jest.mock("../services/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

process.env.DYNAMODB_TABLE = process.env.DYNAMODB_TABLE || "test-table";
process.env.AWS_REGION = process.env.AWS_REGION || "us-west-2";

const express = require("express");
const request = require("supertest");

function buildApp() {
  const app = express();
  app.use(express.json());
  // Use the full index router (registers report routes via registerReport(router))
  const router = require("../routes/meetings/index");
  app.use("/api/meetings", router);
  app.use((err, _req, res, _next) => {
    res.status(500).json({ error: { message: err.message } });
  });
  return app;
}

describe("POST /api/meetings/:id/regenerate interview subtype routing", () => {
  beforeEach(() => {
    mockInvokeModel.mockClear();
    mockQueryMeetingById.mockReset();
  });

  test("passes interviewSubType/LPs to invokeModel when meeting has them", async () => {
    mockQueryMeetingById.mockResolvedValue({
      meetingId: "m1",
      createdAt: "2026-01-01",
      meetingType: "interview",
      interviewSubType: "lp",
      interviewLPs: ["Ownership", "Dive Deep"],
      status: "transcribed",
      transcriptKey: "transcripts/m1/t.txt",
      funasrKey: "transcripts/m1/f.json",
    });

    const app = buildApp();
    await request(app).post("/api/meetings/m1/regenerate").send({});

    expect(mockInvokeModel).toHaveBeenCalled();
    const callArgs = mockInvokeModel.mock.calls[0];
    expect(callArgs[6]).toEqual({
      interviewSubType: "lp",
      interviewLPs: ["Ownership", "Dive Deep"],
    });
  });

  test("legacy interview (no interviewSubType field) calls invokeModel WITHOUT extraOpts", async () => {
    mockQueryMeetingById.mockResolvedValue({
      meetingId: "m2",
      createdAt: "2026-01-01",
      meetingType: "interview",
      status: "transcribed",
      transcriptKey: "transcripts/m2/t.txt",
      funasrKey: "transcripts/m2/f.json",
    });

    const app = buildApp();
    await request(app).post("/api/meetings/m2/regenerate").send({});

    expect(mockInvokeModel).toHaveBeenCalled();
    const callArgs = mockInvokeModel.mock.calls[0];
    expect(callArgs[6] == null).toBe(true);
  });
});
