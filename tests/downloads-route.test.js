"use strict";

jest.mock("dotenv", () => ({ config: jest.fn() }));

const mockQueryMeetingById = jest.fn();
jest.mock("../services/meeting-store", () => ({
  queryMeetingById: (...args) => mockQueryMeetingById(...args),
}));

const mockGetFile = jest.fn();
const mockUploadFile = jest.fn();
const mockGetPresignedDownloadUrl = jest.fn();
jest.mock("../services/s3", () => ({
  getFile: (...args) => mockGetFile(...args),
  uploadFile: (...args) => mockUploadFile(...args),
  getPresignedDownloadUrl: (...args) => mockGetPresignedDownloadUrl(...args),
}));

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

describe("GET /api/meetings/:id/transcript-url", () => {
  const meetingId = "test-meeting-123";

  test("returns 404 when meeting not found", async () => {
    mockQueryMeetingById.mockResolvedValueOnce(null);

    const res = await request(createApp()).get(`/api/meetings/${meetingId}/transcript-url`);

    expect(res.status).toBe(404);
    expect(res.body.error).toEqual({
      code: "MEETING_NOT_FOUND",
      message: "Meeting not found",
    });
  });

  test("returns 400 FUNASR_NOT_READY when funasrKey is missing", async () => {
    mockQueryMeetingById.mockResolvedValueOnce({
      meetingId,
      createdAt: "2026-05-20T00:00:00.000Z",
      status: "processing",
    });

    const res = await request(createApp()).get(`/api/meetings/${meetingId}/transcript-url`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("FUNASR_NOT_READY");
    expect(mockGetFile).not.toHaveBeenCalled();
  });

  test("returns 400 FUNASR_NOT_READY when funasrKey is empty string", async () => {
    mockQueryMeetingById.mockResolvedValueOnce({
      meetingId,
      createdAt: "2026-05-20T00:00:00.000Z",
      funasrKey: "",
    });

    const res = await request(createApp()).get(`/api/meetings/${meetingId}/transcript-url`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("FUNASR_NOT_READY");
  });

  test("happy path: reads funasr, builds transcript, uploads, presigns, returns 200", async () => {
    const speakerMap = { SPEAKER_0: "张三", SPEAKER_1: "李四" };
    mockQueryMeetingById.mockResolvedValueOnce({
      meetingId,
      createdAt: "2026-05-20T00:00:00.000Z",
      funasrKey: `transcripts/${meetingId}/funasr.json`,
      speakerMap,
    });

    const funasrJson = {
      segments: [
        { speaker: 0, text: "你好" },
        { speaker: 1, text: "在的" },
      ],
    };
    async function* genStream() {
      yield Buffer.from(JSON.stringify(funasrJson));
    }
    mockGetFile.mockResolvedValueOnce(genStream());
    mockUploadFile.mockResolvedValueOnce(`transcripts/${meetingId}/transcript.txt`);
    mockGetPresignedDownloadUrl.mockResolvedValueOnce("https://signed.example/transcript");

    const res = await request(createApp()).get(`/api/meetings/${meetingId}/transcript-url`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ url: "https://signed.example/transcript", expiresIn: 900 });
    expect(mockUploadFile).toHaveBeenCalledWith(
      `transcripts/${meetingId}/transcript.txt`,
      "[张三] 你好\n[李四] 在的",
      "text/plain; charset=utf-8"
    );
    expect(mockGetPresignedDownloadUrl).toHaveBeenCalledWith(
      `transcripts/${meetingId}/transcript.txt`,
      { expiresIn: 900 }
    );
  });

  test("handles missing speakerMap gracefully (defaults to empty)", async () => {
    mockQueryMeetingById.mockResolvedValueOnce({
      meetingId,
      createdAt: "2026-05-20T00:00:00.000Z",
      funasrKey: `transcripts/${meetingId}/funasr.json`,
    });
    async function* genStream() {
      yield Buffer.from(JSON.stringify({ segments: [{ speaker: 0, text: "x" }] }));
    }
    mockGetFile.mockResolvedValueOnce(genStream());
    mockUploadFile.mockResolvedValueOnce("ok");
    mockGetPresignedDownloadUrl.mockResolvedValueOnce("https://signed/x");

    const res = await request(createApp()).get(`/api/meetings/${meetingId}/transcript-url`);

    expect(res.status).toBe(200);
    expect(mockUploadFile).toHaveBeenCalledWith(
      expect.any(String),
      "[SPEAKER_0] x",
      "text/plain; charset=utf-8"
    );
  });

  test("returns 500 S3_GET_FAILED when funasr.json read fails", async () => {
    mockQueryMeetingById.mockResolvedValueOnce({
      meetingId,
      createdAt: "2026-05-20T00:00:00.000Z",
      funasrKey: `transcripts/${meetingId}/funasr.json`,
    });
    mockGetFile.mockRejectedValueOnce(new Error("S3 down"));

    const res = await request(createApp()).get(`/api/meetings/${meetingId}/transcript-url`);

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe("S3_GET_FAILED");
  });

  test("returns 500 S3_UPLOAD_FAILED when uploadFile rejects", async () => {
    mockQueryMeetingById.mockResolvedValueOnce({
      meetingId,
      createdAt: "2026-05-20T00:00:00.000Z",
      funasrKey: `transcripts/${meetingId}/funasr.json`,
    });
    async function* genStream() {
      yield Buffer.from(JSON.stringify({ segments: [{ speaker: 0, text: "x" }] }));
    }
    mockGetFile.mockResolvedValueOnce(genStream());
    mockUploadFile.mockRejectedValueOnce(new Error("upload boom"));

    const res = await request(createApp()).get(`/api/meetings/${meetingId}/transcript-url`);

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe("S3_UPLOAD_FAILED");
  });

  test("returns 500 S3_PRESIGN_FAILED when presign rejects", async () => {
    mockQueryMeetingById.mockResolvedValueOnce({
      meetingId,
      createdAt: "2026-05-20T00:00:00.000Z",
      funasrKey: `transcripts/${meetingId}/funasr.json`,
    });
    async function* genStream() {
      yield Buffer.from(JSON.stringify({ segments: [{ speaker: 0, text: "x" }] }));
    }
    mockGetFile.mockResolvedValueOnce(genStream());
    mockUploadFile.mockResolvedValueOnce("ok");
    mockGetPresignedDownloadUrl.mockRejectedValueOnce(new Error("sign boom"));

    const res = await request(createApp()).get(`/api/meetings/${meetingId}/transcript-url`);

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe("S3_PRESIGN_FAILED");
  });
});
