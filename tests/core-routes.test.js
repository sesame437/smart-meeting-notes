"use strict";

/**
 * core-routes.test.js — routes/meetings/core.js 路由层测试
 *
 * 覆盖：GET /, POST /, GET /:id, PUT /:id, DELETE /:id
 */

jest.mock("dotenv", () => ({ config: jest.fn() }));

// Mock meeting-store 模块
const mockListMeetings = jest.fn();
const mockCreateMeeting = jest.fn();
const mockQueryMeetingById = jest.fn();
const mockUpdateMeeting = jest.fn();
const mockDeleteMeeting = jest.fn();
const mockCreateMeetingFromUpload = jest.fn();

jest.mock("../services/meeting-store", () => ({
  listMeetings: (...args) => mockListMeetings(...args),
  createMeeting: (...args) => mockCreateMeeting(...args),
  queryMeetingById: (...args) => mockQueryMeetingById(...args),
  updateMeeting: (...args) => mockUpdateMeeting(...args),
  deleteMeeting: (...args) => mockDeleteMeeting(...args),
  createMeetingFromUpload: (...args) => mockCreateMeetingFromUpload(...args),
}));

// Mock S3 service
const mockGetFile = jest.fn();
jest.mock("../services/s3", () => ({
  uploadFile: jest.fn().mockResolvedValue("inbox/test/file.mp3"),
  getFile: (...args) => mockGetFile(...args),
}));

// Mock SQS service
jest.mock("../services/sqs", () => ({
  sendMessage: jest.fn().mockResolvedValue({}),
}));

// Mock multer for upload tests
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

beforeEach(() => {
  jest.clearAllMocks();
});

describe("GET /api/meetings", () => {
  test("returns 200 with empty array when no meetings", async () => {
    mockListMeetings.mockResolvedValueOnce([]);

    const res = await request(createApp())
      .get("/api/meetings")
      .send();

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
    expect(mockListMeetings).toHaveBeenCalledTimes(1);
  });

  test("returns 200 with meeting list", async () => {
    const meetings = [
      {
        meetingId: "m1",
        createdAt: "2026-02-28T10:00:00.000Z",
        title: "Meeting 1",
        status: "reported",
      },
      {
        meetingId: "m2",
        createdAt: "2026-02-28T09:00:00.000Z",
        title: "Meeting 2",
        status: "transcribed",
      },
    ];
    mockListMeetings.mockResolvedValueOnce(meetings);

    const res = await request(createApp())
      .get("/api/meetings")
      .send();

    expect(res.status).toBe(200);
    expect(res.body).toEqual(meetings);
  });

  test("deduplicates by meetingId and prefers titled items", async () => {
    const meetings = [
      {
        meetingId: "m1",
        createdAt: "2026-02-28T10:00:00.000Z",
        title: "Meeting 1",
        status: "reported",
      },
      {
        meetingId: "m1",
        createdAt: "2026-02-28T09:00:00.000Z",
        status: "pending",
      },
    ];
    mockListMeetings.mockResolvedValueOnce(meetings);

    const res = await request(createApp())
      .get("/api/meetings")
      .send();

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].title).toBe("Meeting 1");
  });

  test("returns 500 when database error occurs", async () => {
    mockListMeetings.mockRejectedValueOnce(new Error("DB error"));

    const res = await request(createApp())
      .get("/api/meetings")
      .send();

    expect(res.status).toBe(500);
  });
});

describe("POST /api/meetings", () => {
  test("returns 201 with created meeting", async () => {
    mockCreateMeeting.mockImplementationOnce((item) => Promise.resolve(item));

    const res = await request(createApp())
      .post("/api/meetings")
      .send({ title: "New Meeting", meetingType: "weekly" });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      title: "New Meeting",
      meetingType: "weekly",
      status: "created",
    });
    expect(res.body.meetingId).toBeDefined();
    expect(res.body.createdAt).toBeDefined();
    expect(mockCreateMeeting).toHaveBeenCalledTimes(1);
  });

  test("returns 201 without title (optional field)", async () => {
    mockCreateMeeting.mockImplementationOnce((item) => Promise.resolve(item));

    const res = await request(createApp())
      .post("/api/meetings")
      .send({ meetingType: "general" });

    expect(res.status).toBe(201);
    expect(res.body.title).toBeUndefined();
    expect(res.body.meetingType).toBe("general");
  });

  test("returns 500 when database error occurs", async () => {
    mockCreateMeeting.mockRejectedValueOnce(new Error("DB error"));

    const res = await request(createApp())
      .post("/api/meetings")
      .send({ title: "Test" });

    expect(res.status).toBe(500);
  });
});

describe("GET /api/meetings/:id", () => {
  test("returns 200 with meeting data", async () => {
    const meeting = {
      meetingId: "test-id",
      createdAt: "2026-02-28T10:00:00.000Z",
      title: "Test Meeting",
      status: "reported",
    };
    mockQueryMeetingById.mockResolvedValueOnce(meeting);

    const res = await request(createApp())
      .get("/api/meetings/test-id")
      .send();

    expect(res.status).toBe(200);
    expect(res.body).toEqual(meeting);
    expect(mockQueryMeetingById).toHaveBeenCalledWith("test-id");
  });

  test("returns 404 when meeting not found", async () => {
    mockQueryMeetingById.mockResolvedValueOnce(null);

    const res = await request(createApp())
      .get("/api/meetings/not-found")
      .send();

    expect(res.status).toBe(404);
    expect(res.body.error).toEqual({ code: "NOT_FOUND", message: "Not found" });
  });

  test("returns 500 when database error occurs", async () => {
    mockQueryMeetingById.mockRejectedValueOnce(new Error("DB error"));

    const res = await request(createApp())
      .get("/api/meetings/test-id")
      .send();

    expect(res.status).toBe(500);
  });
});

describe("PUT /api/meetings/:id", () => {
  test("returns 200 with updated meeting", async () => {
    const existingMeeting = {
      meetingId: "test-id",
      createdAt: "2026-02-28T10:00:00.000Z",
      title: "Old Title",
      status: "pending",
    };
    const updatedMeeting = {
      ...existingMeeting,
      title: "New Title",
      status: "transcribed",
      updatedAt: "2026-02-28T11:00:00.000Z",
    };
    mockQueryMeetingById.mockResolvedValueOnce(existingMeeting);
    mockUpdateMeeting.mockResolvedValueOnce(updatedMeeting);

    const res = await request(createApp())
      .put("/api/meetings/test-id")
      .send({ title: "New Title", status: "transcribed" });

    expect(res.status).toBe(200);
    expect(res.body.title).toBe("New Title");
    expect(res.body.status).toBe("transcribed");
    expect(mockUpdateMeeting).toHaveBeenCalledTimes(1);
  });

  test("returns 404 when meeting not found", async () => {
    mockQueryMeetingById.mockResolvedValueOnce(null);

    const res = await request(createApp())
      .put("/api/meetings/not-found")
      .send({ title: "New Title" });

    expect(res.status).toBe(404);
    expect(res.body.error).toEqual({ code: "NOT_FOUND", message: "Not found" });
    expect(mockUpdateMeeting).not.toHaveBeenCalled();
  });

  test("returns 500 when database error occurs", async () => {
    mockQueryMeetingById.mockResolvedValueOnce({
      meetingId: "test-id",
      createdAt: "2026-02-28T10:00:00.000Z",
    });
    mockUpdateMeeting.mockRejectedValueOnce(new Error("DB error"));

    const res = await request(createApp())
      .put("/api/meetings/test-id")
      .send({ title: "New Title" });

    expect(res.status).toBe(500);
  });
});

describe("DELETE /api/meetings/:id", () => {
  test("returns 204 on successful deletion", async () => {
    const meeting = {
      meetingId: "test-id",
      createdAt: "2026-02-28T10:00:00.000Z",
      title: "Test Meeting",
    };
    mockQueryMeetingById.mockResolvedValueOnce(meeting);
    mockDeleteMeeting.mockResolvedValueOnce(undefined);

    const res = await request(createApp())
      .delete("/api/meetings/test-id")
      .send();

    expect(res.status).toBe(204);
    expect(mockDeleteMeeting).toHaveBeenCalledWith("test-id", meeting.createdAt);
  });

  test("returns 404 when meeting not found", async () => {
    mockQueryMeetingById.mockResolvedValueOnce(null);

    const res = await request(createApp())
      .delete("/api/meetings/not-found")
      .send();

    expect(res.status).toBe(404);
    expect(res.body.error).toEqual({ code: "NOT_FOUND", message: "Not found" });
    expect(mockDeleteMeeting).not.toHaveBeenCalled();
  });

  test("returns 500 when database error occurs", async () => {
    mockQueryMeetingById.mockResolvedValueOnce({
      meetingId: "test-id",
      createdAt: "2026-02-28T10:00:00.000Z",
    });
    mockDeleteMeeting.mockRejectedValueOnce(new Error("DB error"));

    const res = await request(createApp())
      .delete("/api/meetings/test-id")
      .send();

    expect(res.status).toBe(500);
  });
});
