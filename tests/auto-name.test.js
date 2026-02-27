"use strict";

/**
 * auto-name.test.js — POST /api/meetings/:id/auto-name 单元测试
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
jest.mock("../services/s3", () => ({
  uploadFile: jest.fn().mockResolvedValue("meeting-minutes/test"),
  getFile: (...args) => mockGetFile(...args),
}));

jest.mock("../services/sqs", () => ({
  sendMessage: jest.fn().mockResolvedValue({}),
}));

jest.mock("../services/bedrock", () => ({
  invokeModel: jest.fn().mockResolvedValue("{}"),
}));

const mockBedrockSend = jest.fn();
jest.mock("@aws-sdk/client-bedrock-runtime", () => ({
  BedrockRuntimeClient: jest.fn(() => ({ send: mockBedrockSend })),
  InvokeModelCommand: jest.fn((p) => ({ _cmd: "InvokeModelCommand", ...p })),
}));

jest.mock("multer", () => {
  const m = () => ({ single: () => (_req, _res, next) => next() });
  m.diskStorage = jest.fn();
  return m;
});

process.env.DYNAMODB_TABLE = "test-table";
process.env.AWS_REGION = "us-west-2";

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

describe("POST /api/meetings/:id/auto-name", () => {
  const meetingId = "test-meeting-123";
  const meetingItem = {
    meetingId,
    createdAt: "2026-02-26T10:00:00.000Z",
    reportKey: "meeting-minutes/reports/test-meeting-123/report.json",
    title: "test meeting",
    status: "reported",
  };

  const report = {
    summary: "本次会议讨论了AWS医疗行业GenAI解决方案的技术架构和落地方案",
  };

  test("returns suggestedName on success", async () => {
    mockDynamoSend.mockResolvedValueOnce({ Items: [meetingItem] });
    mockGetFile.mockResolvedValueOnce(makeStream(JSON.stringify(report)));
    mockBedrockSend.mockResolvedValueOnce({
      body: new TextEncoder().encode(JSON.stringify({
        content: [{ text: "内部会议-AWS医疗GenAI讨论-20260226" }],
      })),
    });

    const res = await request(createApp())
      .post(`/api/meetings/${meetingId}/auto-name`)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.suggestedName).toBe("内部会议-AWS医疗GenAI讨论-20260226");
  });

  test("returns 404 if meeting not found", async () => {
    mockDynamoSend.mockResolvedValueOnce({ Items: [] });

    const res = await request(createApp())
      .post(`/api/meetings/${meetingId}/auto-name`)
      .send();

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Not found");
  });

  test("returns 400 if no reportKey", async () => {
    mockDynamoSend.mockResolvedValueOnce({
      Items: [{ ...meetingItem, reportKey: undefined }],
    });

    const res = await request(createApp())
      .post(`/api/meetings/${meetingId}/auto-name`)
      .send();

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Report not generated yet");
  });

  test("returns 400 if report has no summary", async () => {
    mockDynamoSend.mockResolvedValueOnce({ Items: [meetingItem] });
    mockGetFile.mockResolvedValueOnce(makeStream(JSON.stringify({ keyTopics: [] })));

    const res = await request(createApp())
      .post(`/api/meetings/${meetingId}/auto-name`)
      .send();

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Report has no summary");
  });

  test("truncates suggestedName to 60 chars", async () => {
    mockDynamoSend.mockResolvedValueOnce({ Items: [meetingItem] });
    mockGetFile.mockResolvedValueOnce(makeStream(JSON.stringify(report)));
    const longName = "A".repeat(100);
    mockBedrockSend.mockResolvedValueOnce({
      body: new TextEncoder().encode(JSON.stringify({
        content: [{ text: longName }],
      })),
    });

    const res = await request(createApp())
      .post(`/api/meetings/${meetingId}/auto-name`)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.suggestedName.length).toBe(60);
  });

  test("uses executive_summary when summary is missing", async () => {
    mockDynamoSend.mockResolvedValueOnce({ Items: [meetingItem] });
    mockGetFile.mockResolvedValueOnce(makeStream(JSON.stringify({
      executive_summary: "讨论了技术架构",
    })));
    mockBedrockSend.mockResolvedValueOnce({
      body: new TextEncoder().encode(JSON.stringify({
        content: [{ text: "技术讨论-架构设计-20260226" }],
      })),
    });

    const res = await request(createApp())
      .post(`/api/meetings/${meetingId}/auto-name`)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.suggestedName).toBe("技术讨论-架构设计-20260226");
  });

  test("calls Bedrock with haiku model", async () => {
    const { InvokeModelCommand } = require("@aws-sdk/client-bedrock-runtime");
    mockDynamoSend.mockResolvedValueOnce({ Items: [meetingItem] });
    mockGetFile.mockResolvedValueOnce(makeStream(JSON.stringify(report)));
    mockBedrockSend.mockResolvedValueOnce({
      body: new TextEncoder().encode(JSON.stringify({
        content: [{ text: "内部会议-测试-20260226" }],
      })),
    });

    await request(createApp())
      .post(`/api/meetings/${meetingId}/auto-name`)
      .send();

    expect(InvokeModelCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
      })
    );
  });
});
