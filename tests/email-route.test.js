"use strict";

/**
 * email-route.test.js — routes/meetings/email.js 路由层测试
 *
 * 覆盖：POST /:id/send-email
 */

jest.mock("dotenv", () => ({ config: jest.fn() }));

// Mock meeting-store 模块
const mockQueryMeetingById = jest.fn();
const mockMarkEmailSent = jest.fn();

jest.mock("../services/meeting-store", () => ({
  queryMeetingById: (...args) => mockQueryMeetingById(...args),
  markEmailSent: (...args) => mockMarkEmailSent(...args),
}));

// Mock SQS service
const mockSendMessage = jest.fn();
jest.mock("../services/sqs", () => ({
  sendMessage: (...args) => mockSendMessage(...args),
}));

// Mock multer (需要，因为 router 会加载 helpers.js)
jest.mock("multer", () => {
  const m = () => ({ single: () => (_req, _res, next) => next(), array: () => (_req, _res, next) => next() });
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

beforeEach(() => {
  jest.clearAllMocks();
});

describe("POST /api/meetings/:id/send-email", () => {
  const meetingId = "test-meeting-123";
  const validMeeting = {
    meetingId,
    createdAt: "2026-02-28T10:00:00.000Z",
    title: "Test Meeting",
    status: "reported",
    reportKey: "reports/test-meeting-123/report.json",
  };

  test("returns 404 when meeting not found", async () => {
    mockQueryMeetingById.mockResolvedValueOnce(null);

    const res = await request(createApp())
      .post(`/api/meetings/${meetingId}/send-email`)
      .send();

    expect(res.status).toBe(404);
    expect(res.body.error).toEqual({
      code: "MEETING_NOT_FOUND",
      message: "Meeting not found",
    });
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  test("returns 400 when reportKey not generated", async () => {
    mockQueryMeetingById.mockResolvedValueOnce({
      ...validMeeting,
      reportKey: undefined,
    });

    const res = await request(createApp())
      .post(`/api/meetings/${meetingId}/send-email`)
      .send();

    expect(res.status).toBe(400);
    expect(res.body.error).toEqual({
      code: "REPORT_NOT_GENERATED",
      message: "Report not generated yet",
    });
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  test("returns 500 when SQS_EXPORT_QUEUE not configured", async () => {
    const oldEnv = process.env.SQS_EXPORT_QUEUE;
    delete process.env.SQS_EXPORT_QUEUE;

    mockQueryMeetingById.mockResolvedValueOnce(validMeeting);

    const res = await request(createApp())
      .post(`/api/meetings/${meetingId}/send-email`)
      .send();

    expect(res.status).toBe(500);
    expect(res.body.error).toEqual({
      code: "QUEUE_NOT_CONFIGURED",
      message: "Export queue not configured",
    });
    expect(mockSendMessage).not.toHaveBeenCalled();

    // Restore env
    if (oldEnv !== undefined) {
      process.env.SQS_EXPORT_QUEUE = oldEnv;
    }
  });

  test("returns 200 when email sending triggered successfully", async () => {
    process.env.SQS_EXPORT_QUEUE = "https://sqs.test/export";

    mockQueryMeetingById.mockResolvedValueOnce(validMeeting);
    mockMarkEmailSent.mockResolvedValueOnce(undefined);
    mockSendMessage.mockResolvedValueOnce({ MessageId: "msg-123" });

    const res = await request(createApp())
      .post(`/api/meetings/${meetingId}/send-email`)
      .send();

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      message: "Email sending triggered",
    });
    expect(mockMarkEmailSent).toHaveBeenCalledWith(meetingId, validMeeting.createdAt);
    expect(mockSendMessage).toHaveBeenCalledWith(
      "https://sqs.test/export",
      {
        meetingId,
        reportKey: validMeeting.reportKey,
        createdAt: validMeeting.createdAt,
        meetingName: validMeeting.title,
      }
    );
  });

  test("includes meetingName in SQS message when title exists", async () => {
    process.env.SQS_EXPORT_QUEUE = "https://sqs.test/export";

    mockQueryMeetingById.mockResolvedValueOnce(validMeeting);
    mockMarkEmailSent.mockResolvedValueOnce(undefined);
    mockSendMessage.mockResolvedValueOnce({ MessageId: "msg-123" });

    await request(createApp())
      .post(`/api/meetings/${meetingId}/send-email`)
      .send();

    const sqsMessage = mockSendMessage.mock.calls[0][1];
    expect(sqsMessage.meetingName).toBe("Test Meeting");
  });

  test("omits meetingName from SQS message when title is missing", async () => {
    process.env.SQS_EXPORT_QUEUE = "https://sqs.test/export";

    mockQueryMeetingById.mockResolvedValueOnce({
      ...validMeeting,
      title: undefined,
    });
    mockMarkEmailSent.mockResolvedValueOnce(undefined);
    mockSendMessage.mockResolvedValueOnce({ MessageId: "msg-123" });

    await request(createApp())
      .post(`/api/meetings/${meetingId}/send-email`)
      .send();

    const sqsMessage = mockSendMessage.mock.calls[0][1];
    expect(sqsMessage.meetingName).toBeUndefined();
  });

  test("returns 500 when database error occurs", async () => {
    process.env.SQS_EXPORT_QUEUE = "https://sqs.test/export";

    mockQueryMeetingById.mockRejectedValueOnce(new Error("DB error"));

    const res = await request(createApp())
      .post(`/api/meetings/${meetingId}/send-email`)
      .send();

    expect(res.status).toBe(500);
  });

  test("returns 500 when SQS sendMessage fails", async () => {
    process.env.SQS_EXPORT_QUEUE = "https://sqs.test/export";

    mockQueryMeetingById.mockResolvedValueOnce(validMeeting);
    mockMarkEmailSent.mockResolvedValueOnce(undefined);
    mockSendMessage.mockRejectedValueOnce(new Error("SQS error"));

    const res = await request(createApp())
      .post(`/api/meetings/${meetingId}/send-email`)
      .send();

    expect(res.status).toBe(500);
  });
});
