"use strict";

/**
 * report-routes.test.js — routes/meetings/report.js 路由集成测试
 */

const { Readable } = require("stream");

jest.mock("dotenv", () => ({ config: jest.fn() }));

const mockDynamoSend = jest.fn();
jest.mock("../db/dynamodb", () => ({ docClient: { send: mockDynamoSend } }));

jest.mock("@aws-sdk/lib-dynamodb", () => ({
  ScanCommand: jest.fn((p) => ({ _cmd: "ScanCommand", ...p })),
  QueryCommand: jest.fn((p) => ({ _cmd: "QueryCommand", ...p })),
  PutCommand: jest.fn((p) => ({ _cmd: "PutCommand", ...p })),
  UpdateCommand: jest.fn((p) => ({ _cmd: "UpdateCommand", ...p })),
  DeleteCommand: jest.fn((p) => ({ _cmd: "DeleteCommand", ...p })),
}));

const mockGetFile = jest.fn();
const mockUploadFile = jest.fn();
jest.mock("../services/s3", () => ({
  uploadFile: (...args) => mockUploadFile(...args),
  getFile: (...args) => mockGetFile(...args),
}));

jest.mock("../services/sqs", () => ({
  sendMessage: jest.fn().mockResolvedValue({}),
}));

const mockInvokeModel = jest.fn();
jest.mock("../services/bedrock", () => ({
  invokeModel: (...args) => mockInvokeModel(...args),
}));

jest.mock("multer", () => {
  const m = () => ({ single: () => (_req, _res, next) => next() });
  m.diskStorage = jest.fn();
  return m;
});

process.env.DYNAMODB_TABLE = "test-table";
process.env.AWS_REGION = "us-west-2";
process.env.GLOSSARY_TABLE = "test-glossary";

const express = require("express");
const request = require("supertest");
const router = require("../routes/meetings/index");

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/meetings", router);
  return app;
}

function makeStream(content) {
  return Readable.from([Buffer.from(content)]);
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("POST /api/meetings/merge", () => {
  test("returns 201 with report on success", async () => {
    const mid1 = "a1b2c3d4-e5f6-4a5b-8c7d-9e8f7a6b5c4d";
    const mid2 = "b2c3d4e5-f6a7-4b5c-8d7e-9f8a7b6c5d4e";
    const meeting1 = {
      meetingId: mid1,
      createdAt: "2026-02-26T10:00:00.000Z",
      title: "Meeting 1",
      reportKey: "reports/m1/report.json",
    };
    const meeting2 = {
      meetingId: mid2,
      createdAt: "2026-02-26T11:00:00.000Z",
      title: "Meeting 2",
      reportKey: "reports/m2/report.json",
    };

    mockDynamoSend
      .mockResolvedValueOnce({ Items: [meeting1] }) // getMeetingById for m1
      .mockResolvedValueOnce({ Items: [meeting2] }) // getMeetingById for m2
      .mockResolvedValueOnce({ Items: [] }) // getGlossaryItems
      .mockResolvedValueOnce({}); // saveReport (PutCommand)

    mockGetFile
      .mockResolvedValueOnce(makeStream(JSON.stringify({ summary: "Summary 1" })))
      .mockResolvedValueOnce(makeStream(JSON.stringify({ summary: "Summary 2" })));

    mockInvokeModel.mockResolvedValueOnce(JSON.stringify({ summary: "Merged summary" }));
    mockUploadFile.mockResolvedValueOnce("reports/merged/report.json");

    const res = await request(createApp())
      .post("/api/meetings/merge")
      .send({ meetingIds: [mid1, mid2] });

    expect(res.status).toBe(201);
    expect(res.body.meetingId).toBeDefined();
    expect(res.body.report).toBeDefined();
  });

  test("returns 400 if meetingIds is not an array", async () => {
    const res = await request(createApp())
      .post("/api/meetings/merge")
      .send({ meetingIds: "not-an-array" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  test("returns 400 if meetingIds has less than 2 items", async () => {
    const res = await request(createApp())
      .post("/api/meetings/merge")
      .send({ meetingIds: ["a1b2c3d4-e5f6-4a5b-8c7d-9e8f7a6b5c4d"] });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("PUT /api/meetings/:id/speaker-names", () => {
  test("returns 200 on success", async () => {
    const meeting = {
      meetingId: "test-123",
      createdAt: "2026-02-26T10:00:00.000Z",
    };

    mockDynamoSend
      .mockResolvedValueOnce({ Items: [meeting] })
      .mockResolvedValueOnce({});

    const res = await request(createApp())
      .put("/api/meetings/test-123/speaker-names")
      .send({ speakerMap: { SPEAKER_00: "Alice" } });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test("returns 404 if meeting not found", async () => {
    mockDynamoSend.mockResolvedValueOnce({ Items: [] });

    const res = await request(createApp())
      .put("/api/meetings/nonexistent/speaker-names")
      .send({ speakerMap: { SPEAKER_00: "Alice" } });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("MEETING_NOT_FOUND");
  });

  test("returns 400 if speakerMap is invalid", async () => {
    const meeting = {
      meetingId: "test-123",
      createdAt: "2026-02-26T10:00:00.000Z",
    };

    mockDynamoSend.mockResolvedValueOnce({ Items: [meeting] });

    const res = await request(createApp())
      .put("/api/meetings/test-123/speaker-names")
      .send({ speakerMap: { "": "Invalid" } });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  test("returns 200 with multiple speakers", async () => {
    const meeting = {
      meetingId: "test-123",
      createdAt: "2026-02-26T10:00:00.000Z",
    };

    mockDynamoSend
      .mockResolvedValueOnce({ Items: [meeting] })
      .mockResolvedValueOnce({});

    const res = await request(createApp())
      .put("/api/meetings/test-123/speaker-names")
      .send({
        speakerMap: {
          SPEAKER_00: "Alice",
          SPEAKER_01: "Bob",
          SPEAKER_02: "Charlie",
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test("returns 400 if speaker name exceeds 100 chars", async () => {
    const meeting = {
      meetingId: "test-123",
      createdAt: "2026-02-26T10:00:00.000Z",
    };

    mockDynamoSend.mockResolvedValueOnce({ Items: [meeting] });

    const res = await request(createApp())
      .put("/api/meetings/test-123/speaker-names")
      .send({ speakerMap: { SPEAKER_00: "A".repeat(101) } });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("PATCH /api/meetings/:id/report", () => {
  test("returns 400 if section is invalid", async () => {
    const meeting = {
      meetingId: "test-123",
      createdAt: "2026-02-26T10:00:00.000Z",
      reportKey: "reports/test-123/report.json",
    };

    mockDynamoSend.mockResolvedValueOnce({ Items: [meeting] });

    const res = await request(createApp())
      .patch("/api/meetings/test-123/report")
      .send({ section: "invalidSection", data: "Some data" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_SECTION");
  });
});
