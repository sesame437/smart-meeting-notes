"use strict";

/**
 * report-patch.test.js — PATCH /api/meetings/:id/report 单元测试
 */

const { Readable } = require("stream");

// Mock dependencies before requiring router
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

let uploadedContent = null;
const mockUploadFile = jest.fn((_key, body) => {
  uploadedContent = body;
  return Promise.resolve("meeting-minutes/" + _key);
});
const mockGetFile = jest.fn();
jest.mock("../services/s3", () => ({
  uploadFile: (...args) => mockUploadFile(...args),
  getFile: (...args) => mockGetFile(...args),
}));

jest.mock("../services/sqs", () => ({
  sendMessage: jest.fn().mockResolvedValue({}),
}));

jest.mock("../services/bedrock", () => ({
  invokeModel: jest.fn().mockResolvedValue("{}"),
}));

jest.mock("multer", () => {
  const m = () => ({ single: () => (_req, _res, next) => next() });
  m.diskStorage = jest.fn();
  return m;
});

process.env.DYNAMODB_TABLE = "test-table";

const express = require("express");
const request = require("supertest");
const meetingsRouter = require("../routes/meetings");

const app = express();
app.use(express.json());
app.use("/api/meetings", meetingsRouter);

function makeStream(str) {
  return Readable.from([Buffer.from(str)]);
}

const SAMPLE_REPORT = {
  summary: "Old summary text",
  actions: [
    { task: "Task A", owner: "Alice", deadline: "2026-03-01", priority: "high" },
    { task: "Task B", owner: "Bob", deadline: "2026-03-15", priority: "medium" },
  ],
  decisions: ["Decision 1", "Decision 2"],
};

const MEETING_ITEM = {
  meetingId: "test-123",
  createdAt: "2026-02-20T00:00:00.000Z",
  status: "completed",
  reportKey: "meeting-minutes/reports/test-123/report.json",
};

describe("PATCH /api/meetings/:id/report", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    uploadedContent = null;
    mockDynamoSend.mockResolvedValue({});
  });

  function setupMeeting() {
    // QueryCommand returns the meeting
    mockDynamoSend.mockResolvedValueOnce({ Items: [MEETING_ITEM] });
    // UpdateCommand
    mockDynamoSend.mockResolvedValueOnce({});
    mockGetFile.mockResolvedValueOnce(makeStream(JSON.stringify(SAMPLE_REPORT)));
  }

  test("updates summary successfully", async () => {
    setupMeeting();

    const res = await request(app)
      .patch("/api/meetings/test-123/report")
      .send({ section: "summary", data: "New summary" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockUploadFile).toHaveBeenCalledTimes(1);
    const saved = JSON.parse(uploadedContent);
    expect(saved.summary).toBe("New summary");
    // Other fields preserved
    expect(saved.actions).toHaveLength(2);
    expect(saved.decisions).toHaveLength(2);
  });

  test("updates actionItems successfully", async () => {
    setupMeeting();
    const newActions = [{ task: "Only task", owner: "Carol", deadline: "2026-04-01", priority: "low" }];

    const res = await request(app)
      .patch("/api/meetings/test-123/report")
      .send({ section: "actionItems", data: newActions });

    expect(res.status).toBe(200);
    const saved = JSON.parse(uploadedContent);
    expect(saved.actions).toHaveLength(1);
    expect(saved.actions[0].task).toBe("Only task");
    expect(saved.summary).toBe("Old summary text");
  });

  test("updates keyDecisions successfully", async () => {
    setupMeeting();

    const res = await request(app)
      .patch("/api/meetings/test-123/report")
      .send({ section: "keyDecisions", data: ["New decision only"] });

    expect(res.status).toBe(200);
    const saved = JSON.parse(uploadedContent);
    expect(saved.decisions).toHaveLength(1);
    expect(saved.decisions[0]).toBe("New decision only");
  });

  test("rejects invalid section", async () => {
    const res = await request(app)
      .patch("/api/meetings/test-123/report")
      .send({ section: "invalid", data: "foo" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid section/);
  });

  test("rejects missing data", async () => {
    const res = await request(app)
      .patch("/api/meetings/test-123/report")
      .send({ section: "summary" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/data is required/);
  });

  test("returns 404 for non-existent meeting", async () => {
    mockDynamoSend.mockResolvedValueOnce({ Items: [] });

    const res = await request(app)
      .patch("/api/meetings/nonexistent/report")
      .send({ section: "summary", data: "x" });

    expect(res.status).toBe(404);
  });

  test("returns 400 when no report exists", async () => {
    mockDynamoSend.mockResolvedValueOnce({
      Items: [{ meetingId: "no-report", createdAt: "2026-01-01T00:00:00.000Z", status: "created" }],
    });

    const res = await request(app)
      .patch("/api/meetings/no-report/report")
      .send({ section: "summary", data: "x" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/No report/);
  });
});
