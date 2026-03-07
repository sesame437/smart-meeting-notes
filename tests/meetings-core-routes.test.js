const mockStore = {
  listMeetings: jest.fn(),
  createMeeting: jest.fn(),
  queryMeetingById: jest.fn(),
  updateMeeting: jest.fn(),
  deleteMeeting: jest.fn(),
  retryMeeting: jest.fn(),
  rollbackRetry: jest.fn(),
};

const mockS3 = {
  getFile: jest.fn(),
  uploadFile: jest.fn(),
  deleteObject: jest.fn(),
  uploadStream: jest.fn(),
};

const mockSQS = {
  sendMessage: jest.fn(),
};

const mockGPU = {
  warmUpGPU: jest.fn(),
};

jest.mock("../services/meeting-store", () => mockStore);
jest.mock("../services/s3", () => mockS3);
jest.mock("../services/sqs", () => mockSQS);
jest.mock("../services/gpu-autoscale", () => mockGPU);
jest.mock("../services/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const request = require("supertest");
const express = require("express");
const register = require("../routes/meetings/core");

describe("meetings-core-routes", () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = express();
    app.use(express.json());
    const router = express.Router();
    register(router);
    app.use("/api/meetings", router);
  });

  describe("GET /", () => {
    it("should list meetings with deduplication", async () => {
      const mockMeetings = [
        { meetingId: "1", createdAt: "2026-01-01T00:00:00Z", title: "Meeting 1" },
        { meetingId: "1", createdAt: "2026-01-02T00:00:00Z" },
        { meetingId: "2", createdAt: "2026-01-03T00:00:00Z", title: "Meeting 2" },
      ];
      mockStore.listMeetings.mockResolvedValueOnce(mockMeetings);

      const res = await request(app).get("/api/meetings");

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      expect(res.body[0].meetingId).toBe("2");
      expect(res.body[1].meetingId).toBe("1");
      expect(res.body[1].title).toBe("Meeting 1");
    });
  });

  describe("POST /", () => {
    it("should create meeting with all fields", async () => {
      mockStore.createMeeting.mockResolvedValueOnce({});

      const res = await request(app)
        .post("/api/meetings")
        .send({ title: "Test", meetingType: "tech", recipientEmails: "test@example.com" });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        title: "Test",
        meetingType: "tech",
        recipientEmails: "test@example.com",
        status: "created",
      });
      expect(mockStore.createMeeting).toHaveBeenCalled();
    });

    it("should create meeting with minimal fields", async () => {
      mockStore.createMeeting.mockResolvedValueOnce({});

      const res = await request(app).post("/api/meetings").send({});

      expect(res.status).toBe(201);
      expect(res.body.status).toBe("created");
    });
  });

  describe("GET /:id", () => {
    it("should return meeting by id", async () => {
      const mockMeeting = { meetingId: "123", title: "Test", createdAt: "2026-01-01T00:00:00Z" };
      mockStore.queryMeetingById.mockResolvedValueOnce(mockMeeting);

      const res = await request(app).get("/api/meetings/123");

      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockMeeting);
    });

    it("should return 404 when meeting not found", async () => {
      mockStore.queryMeetingById.mockResolvedValueOnce(null);

      const res = await request(app).get("/api/meetings/nonexistent");

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    });

    it("should load content from S3 when reportKey exists", async () => {
      const mockMeeting = { meetingId: "123", reportKey: "s3://bucket/report.json", createdAt: "2026-01-01T00:00:00Z" };
      const mockContent = { summary: "Test summary" };
      mockStore.queryMeetingById.mockResolvedValueOnce(mockMeeting);
      mockS3.getFile.mockResolvedValueOnce((async function* () {
        yield Buffer.from(JSON.stringify(mockContent));
      })());

      const res = await request(app).get("/api/meetings/123");

      expect(res.status).toBe(200);
      expect(res.body.content).toEqual(mockContent);
    });
  });

  describe("PUT /:id", () => {
    it("should update meeting with valid data", async () => {
      const mockMeeting = { meetingId: "123", createdAt: "2026-01-01T00:00:00Z" };
      mockStore.queryMeetingById.mockResolvedValueOnce(mockMeeting);
      mockStore.updateMeeting.mockResolvedValueOnce({ ...mockMeeting, title: "Updated" });

      const res = await request(app)
        .put("/api/meetings/123")
        .send({ title: "Updated", status: "completed" });

      expect(res.status).toBe(200);
      expect(mockStore.updateMeeting).toHaveBeenCalled();
    });

    it("should return 400 for invalid data", async () => {
      const res = await request(app)
        .put("/api/meetings/123")
        .send({ meetingType: "invalid-type" });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("should return 404 when meeting not found", async () => {
      mockStore.queryMeetingById.mockResolvedValueOnce(null);

      const res = await request(app)
        .put("/api/meetings/nonexistent")
        .send({ title: "Updated" });

      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /:id", () => {
    it("should delete meeting and S3 objects", async () => {
      const mockMeeting = {
        meetingId: "123",
        createdAt: "2026-01-01T00:00:00Z",
        s3Key: "s3://bucket/file.mp3",
        reportKey: "s3://bucket/report.json",
      };
      mockStore.queryMeetingById.mockResolvedValueOnce(mockMeeting);
      mockStore.deleteMeeting.mockResolvedValueOnce({});
      mockS3.deleteObject.mockResolvedValue({});

      const res = await request(app).delete("/api/meetings/123");

      expect(res.status).toBe(204);
      expect(mockS3.deleteObject).toHaveBeenCalledTimes(2);
      expect(mockStore.deleteMeeting).toHaveBeenCalledWith("123", mockMeeting.createdAt);
    });

    it("should return 404 when meeting not found", async () => {
      mockStore.queryMeetingById.mockResolvedValueOnce(null);

      const res = await request(app).delete("/api/meetings/nonexistent");

      expect(res.status).toBe(404);
    });
  });

  describe("POST /:id/start-transcription", () => {
    it("should start transcription for uploaded meeting", async () => {
      const mockMeeting = { meetingId: "123", status: "uploaded", createdAt: "2026-01-01T00:00:00Z", s3Key: "inbox/file.mp3" };
      mockStore.queryMeetingById.mockResolvedValueOnce(mockMeeting);
      mockStore.updateMeeting.mockResolvedValueOnce({});
      mockSQS.sendMessage.mockResolvedValueOnce({});

      const res = await request(app).post("/api/meetings/123/start-transcription");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockSQS.sendMessage).toHaveBeenCalled();
    });

    it("should return 404 when meeting not found", async () => {
      mockStore.queryMeetingById.mockResolvedValueOnce(null);

      const res = await request(app).post("/api/meetings/nonexistent/start-transcription");

      expect(res.status).toBe(404);
    });

    it("should return 400 for invalid status", async () => {
      const mockMeeting = { meetingId: "123", status: "completed", createdAt: "2026-01-01T00:00:00Z" };
      mockStore.queryMeetingById.mockResolvedValueOnce(mockMeeting);

      const res = await request(app).post("/api/meetings/123/start-transcription");

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_STATUS");
    });
  });

  describe("POST /:id/retry", () => {
    it("should retry failed meeting", async () => {
      const mockMeeting = { meetingId: "123", status: "failed", createdAt: "2026-01-01T00:00:00Z", s3Key: "inbox/file.mp3" };
      mockStore.queryMeetingById.mockResolvedValueOnce(mockMeeting);
      mockStore.retryMeeting.mockResolvedValueOnce({});
      mockSQS.sendMessage.mockResolvedValueOnce({});

      const res = await request(app).post("/api/meetings/123/retry");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("should return 404 when meeting not found", async () => {
      mockStore.queryMeetingById.mockResolvedValueOnce(null);

      const res = await request(app).post("/api/meetings/nonexistent/retry");

      expect(res.status).toBe(404);
    });

    it("should return 400 for non-failed meeting", async () => {
      const mockMeeting = { meetingId: "123", status: "completed", createdAt: "2026-01-01T00:00:00Z" };
      mockStore.queryMeetingById.mockResolvedValueOnce(mockMeeting);

      const res = await request(app).post("/api/meetings/123/retry");

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_STATUS");
    });

    it("should handle conditional check failure", async () => {
      const mockMeeting = { meetingId: "123", status: "failed", createdAt: "2026-01-01T00:00:00Z" };
      mockStore.queryMeetingById.mockResolvedValueOnce(mockMeeting);
      const condErr = new Error("Condition failed");
      condErr.name = "ConditionalCheckFailedException";
      mockStore.retryMeeting.mockRejectedValueOnce(condErr);

      const res = await request(app).post("/api/meetings/123/retry");

      expect(res.status).toBe(409);
    });

    it("should rollback on SQS failure", async () => {
      const mockMeeting = { meetingId: "123", status: "failed", createdAt: "2026-01-01T00:00:00Z", s3Key: "inbox/file.mp3" };
      mockStore.queryMeetingById.mockResolvedValueOnce(mockMeeting);
      mockStore.retryMeeting.mockResolvedValueOnce({});
      mockStore.rollbackRetry.mockResolvedValueOnce({});
      mockSQS.sendMessage.mockRejectedValueOnce(new Error("SQS error"));

      const res = await request(app).post("/api/meetings/123/retry");

      expect(res.status).toBe(500);
      expect(mockStore.rollbackRetry).toHaveBeenCalled();
    });
  });
});
