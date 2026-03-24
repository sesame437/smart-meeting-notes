"use strict";

/**
 * upload-multiple.test.js — 多文件上传路由测试
 */

jest.mock("dotenv", () => ({ config: jest.fn() }));

// Mock meeting-store
const mockCreateMeetingFromUpload = jest.fn();
jest.mock("../services/meeting-store", () => ({
  createMeetingFromUpload: (...args) => mockCreateMeetingFromUpload(...args),
}));

// Mock S3 service
const mockUploadFile = jest.fn();
jest.mock("../services/s3", () => ({
  uploadFile: (...args) => mockUploadFile(...args),
}));

// Mock ffmpeg service
const mockMergeAudioFiles = jest.fn();
jest.mock("../services/ffmpeg", () => ({
  mergeAudioFiles: (...args) => mockMergeAudioFiles(...args),
}));

// Mock fs for cleanup
const mockUnlink = jest.fn();
const mockReadFile = jest.fn();
jest.mock("fs", () => ({
  ...jest.requireActual("fs"),
  existsSync: jest.fn().mockReturnValue(true),
  unlinkSync: jest.fn(),
  promises: {
    unlink: (...args) => mockUnlink(...args),
    readFile: (...args) => mockReadFile(...args),
  },
}));

// Mock multer for multiple file upload
const mockArrayMiddleware = jest.fn();
jest.mock("multer", () => {
  const multer = (options) => ({
    single: jest.fn(() => (req, res, next) => next()),
    array: jest.fn(() => mockArrayMiddleware),
    limits: options?.limits || {},
  });

  multer.diskStorage = jest.fn();

  return multer;
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

  // Default: successful multer processing
  mockArrayMiddleware.mockImplementation((req, res, next) => {
    req.files = [
      { path: "/tmp/file1.mp3", originalname: "audio1.mp3", size: 1024 },
      { path: "/tmp/file2.mp3", originalname: "audio2.mp3", size: 2048 },
    ];
    next();
  });
});

describe("POST /api/meetings/upload-multiple", () => {
  test("should return 400 when no files provided", async () => {
    mockArrayMiddleware.mockImplementationOnce((req, res, next) => {
      req.files = [];
      next();
    });

    const res = await request(createApp())
      .post("/api/meetings/upload-multiple")
      .send();

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("NO_FILES");
  });

  test("should merge files and create meeting record", async () => {
    mockMergeAudioFiles.mockResolvedValueOnce("/tmp/merged.ogg");
    mockReadFile.mockResolvedValueOnce(Buffer.from("merged audio data"));
    mockUploadFile.mockResolvedValueOnce("inbox/meeting-123/audio1-merged.ogg");
    mockCreateMeetingFromUpload.mockResolvedValueOnce({});
    mockUnlink.mockResolvedValue();

    mockArrayMiddleware.mockImplementationOnce((req, res, next) => {
      req.files = [
        { path: "/tmp/file1.mp3", originalname: "audio1.mp3", size: 1024 },
        { path: "/tmp/file2.mp3", originalname: "audio2.mp3", size: 2048 },
      ];
      req.body = { title: "Test Meeting", meetingType: "general" };
      next();
    });

    const res = await request(createApp())
      .post("/api/meetings/upload-multiple")
      .send();

    expect(res.status).toBe(201);
    expect(res.body.meetingId).toBeDefined();
    expect(res.body.status).toBe("uploaded");
    expect(res.body.title).toBe("Test Meeting");
    expect(res.body.meetingType).toBe("general");

    // Verify merge was called
    expect(mockMergeAudioFiles).toHaveBeenCalledWith(
      ["/tmp/file1.mp3", "/tmp/file2.mp3"],
      expect.stringMatching(/\/tmp\/merged-.*\.ogg$/)
    );

    // Verify file was uploaded to S3
    expect(mockUploadFile).toHaveBeenCalledWith(
      expect.stringMatching(/inbox\/.*\/audio1-merged\.ogg$/),
      Buffer.from("merged audio data"),
      "audio/ogg"
    );

    // Verify meeting record was created
    expect(mockCreateMeetingFromUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        meetingId: expect.any(String),
        title: "Test Meeting",
        status: "uploaded",
        meetingType: "general",
      })
    );

    // Verify cleanup
    expect(mockUnlink).toHaveBeenCalledTimes(3); // 2 input files + 1 merged file
  });

  test("should handle single file upload", async () => {
    mockMergeAudioFiles.mockResolvedValueOnce("/tmp/merged.ogg");
    mockReadFile.mockResolvedValueOnce(Buffer.from("audio data"));
    mockUploadFile.mockResolvedValueOnce("inbox/meeting-123/audio-merged.ogg");
    mockCreateMeetingFromUpload.mockResolvedValueOnce({});
    mockUnlink.mockResolvedValue();

    mockArrayMiddleware.mockImplementationOnce((req, res, next) => {
      req.files = [{ path: "/tmp/file1.mp3", originalname: "audio.mp3", size: 1024 }];
      req.body = { meetingType: "tech" };
      next();
    });

    const res = await request(createApp())
      .post("/api/meetings/upload-multiple")
      .send();

    expect(res.status).toBe(201);
    expect(res.body.meetingId).toBeDefined();
    expect(mockMergeAudioFiles).toHaveBeenCalledWith(
      ["/tmp/file1.mp3"],
      expect.stringMatching(/\/tmp\/merged-.*\.ogg$/)
    );
  });

  test("should return 400 with validation error", async () => {
    mockArrayMiddleware.mockImplementationOnce((req, res, next) => {
      req.files = [
        { path: "/tmp/file1.mp3", originalname: "audio1.mp3", size: 1024 },
      ];
      req.body = { title: "a".repeat(201) }; // exceeds max length
      next();
    });

    const res = await request(createApp())
      .post("/api/meetings/upload-multiple")
      .send();

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  test("should return 413 when file too large", async () => {
    mockArrayMiddleware.mockImplementationOnce((req, res, next) => {
      const err = new Error("File too large");
      err.code = "LIMIT_FILE_SIZE";
      next(err);
    });

    const res = await request(createApp())
      .post("/api/meetings/upload-multiple")
      .send();

    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe("FILE_TOO_LARGE");
  });

  test("should return 400 when too many files", async () => {
    mockArrayMiddleware.mockImplementationOnce((req, res, next) => {
      const err = new Error("Too many files");
      err.code = "LIMIT_FILE_COUNT";
      next(err);
    });

    const res = await request(createApp())
      .post("/api/meetings/upload-multiple")
      .send();

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("TOO_MANY_FILES");
  });

  test("should cleanup files on merge error", async () => {
    mockMergeAudioFiles.mockRejectedValueOnce(new Error("ffmpeg merge failed"));
    mockUnlink.mockResolvedValue();

    mockArrayMiddleware.mockImplementationOnce((req, res, next) => {
      req.files = [
        { path: "/tmp/file1.mp3", originalname: "audio1.mp3", size: 1024 },
        { path: "/tmp/file2.mp3", originalname: "audio2.mp3", size: 2048 },
      ];
      req.body = { title: "Test Meeting" };
      next();
    });

    const res = await request(createApp())
      .post("/api/meetings/upload-multiple")
      .send();

    expect(res.status).toBe(500);

    // Verify cleanup was attempted even on error
    expect(mockUnlink).toHaveBeenCalled();
  });

  test("should parse and validate recipient emails", async () => {
    mockMergeAudioFiles.mockResolvedValueOnce("/tmp/merged.ogg");
    mockReadFile.mockResolvedValueOnce(Buffer.from("audio data"));
    mockUploadFile.mockResolvedValueOnce("inbox/meeting-123/audio-merged.ogg");
    mockCreateMeetingFromUpload.mockResolvedValueOnce({});
    mockUnlink.mockResolvedValue();

    mockArrayMiddleware.mockImplementationOnce((req, res, next) => {
      req.files = [{ path: "/tmp/file1.mp3", originalname: "audio.mp3", size: 1024 }];
      req.body = { recipientEmails: "user1@example.com, user2@example.com, invalid-email" };
      next();
    });

    const res = await request(createApp())
      .post("/api/meetings/upload-multiple")
      .send();

    expect(res.status).toBe(201);

    // Verify only valid emails were stored
    expect(mockCreateMeetingFromUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientEmails: ["user1@example.com", "user2@example.com"],
      })
    );
  });

  test("should use default meetingType when not provided", async () => {
    mockMergeAudioFiles.mockResolvedValueOnce("/tmp/merged.ogg");
    mockReadFile.mockResolvedValueOnce(Buffer.from("audio data"));
    mockUploadFile.mockResolvedValueOnce("inbox/meeting-123/audio-merged.ogg");
    mockCreateMeetingFromUpload.mockResolvedValueOnce({});
    mockUnlink.mockResolvedValue();

    mockArrayMiddleware.mockImplementationOnce((req, res, next) => {
      req.files = [{ path: "/tmp/file1.mp3", originalname: "audio.mp3", size: 1024 }];
      next();
    });

    const res = await request(createApp())
      .post("/api/meetings/upload-multiple")
      .send();

    expect(res.status).toBe(201);
    expect(res.body.meetingType).toBe("general");
  });
});
