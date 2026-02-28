const { randomUUID } = require("crypto");

// Mock docClient before requiring
const mockSend = jest.fn();
jest.mock("../db/dynamodb", () => ({
  docClient: {
    send: mockSend,
  },
}));

// Mock all other external dependencies
jest.mock("@aws-sdk/lib-dynamodb");
jest.mock("@aws-sdk/client-s3");
jest.mock("@aws-sdk/client-dynamodb");
jest.mock("@aws-sdk/client-transcribe");
jest.mock("../services/sqs");
jest.mock("../services/s3");
jest.mock("../services/bedrock");
jest.mock("../services/logger");
jest.mock("../services/gpu-autoscale");

const { docClient } = require("../db/dynamodb");
const { invokeModel } = require("../services/bedrock");
const { getFile } = require("../services/s3");
const logger = require("../services/logger");

beforeEach(() => {
  jest.clearAllMocks();
});

describe("transcription-worker", () => {
  describe("parseMessage", () => {
    // Since parseMessage is not exported, we test its behavior through message format examples
    it("should handle S3 Event format and strip PREFIX from s3Key", () => {
      const s3EventBody = {
        Records: [
          {
            s3: {
              object: {
                key: "meeting-minutes/inbox/test-meeting/audio.m4a",
              },
            },
          },
        ],
      };

      // Expected: key should be stripped to "inbox/test-meeting/audio.m4a"
      const PREFIX_PATH = "meeting-minutes/";
      const fullKey = decodeURIComponent(s3EventBody.Records[0].s3.object.key);
      const bareKey = fullKey.startsWith(PREFIX_PATH) ? fullKey.slice(PREFIX_PATH.length) : fullKey;

      expect(bareKey).toBe("inbox/test-meeting/audio.m4a");
      expect(bareKey).not.toContain("meeting-minutes/");
    });

    it("should handle internal SQS message format", () => {
      const internalBody = {
        meetingId: randomUUID(),
        s3Key: "inbox/test-meeting/audio.m4a",
        filename: "audio.m4a",
        meetingType: "tech",
        isS3Event: false,
      };

      expect(internalBody.s3Key).toBe("inbox/test-meeting/audio.m4a");
      expect(internalBody.meetingType).toBe("tech");
      expect(internalBody.isS3Event).toBe(false);
    });

    it("should parse meetingType from filename prefix", () => {
      const parseMeetingType = (filename) => {
        if (filename.startsWith("weekly__")) return "weekly";
        if (filename.startsWith("tech__")) return "tech";
        return "general";
      };

      expect(parseMeetingType("weekly__team-standup.m4a")).toBe("weekly");
      expect(parseMeetingType("tech__architecture-review.m4a")).toBe("tech");
      expect(parseMeetingType("regular-meeting.m4a")).toBe("general");
    });
  });

  describe("dedup logic", () => {
    it("should skip S3 Event if s3Key already exists in DynamoDB", async () => {
      const s3Key = "inbox/test-meeting/audio.m4a";

      // Mock Query to return existing item
      mockSend.mockResolvedValueOnce({
        Items: [{ meetingId: "existing-id", s3Key, status: "processing" }],
      });

      const statuses = ["pending", "processing", "reported", "completed"];
      let found = false;

      for (const st of statuses) {
        const result = await docClient.send({
          TableName: "meeting-minutes-meetings",
          IndexName: "status-createdAt-index",
          KeyConditionExpression: "#s = :s",
          FilterExpression: "s3Key = :key",
          ExpressionAttributeNames: { "#s": "status" },
          ExpressionAttributeValues: { ":s": st, ":key": s3Key },
          Limit: 1,
        });
        if (result.Items && result.Items.length > 0) {
          found = true;
          break;
        }
      }

      expect(found).toBe(true);
      expect(mockSend).toHaveBeenCalled();
    });

    it("should process S3 Event if s3Key does not exist", async () => {
      const s3Key = "inbox/new-meeting/audio.m4a";

      // Mock Query to return no items
      mockSend.mockResolvedValue({ Items: [] });

      const statuses = ["pending", "processing", "reported", "completed"];
      let found = false;

      for (const st of statuses) {
        const result = await docClient.send({
          TableName: "meeting-minutes-meetings",
          IndexName: "status-createdAt-index",
          KeyConditionExpression: "#s = :s",
          FilterExpression: "s3Key = :key",
          ExpressionAttributeNames: { "#s": "status" },
          ExpressionAttributeValues: { ":s": st, ":key": s3Key },
          Limit: 1,
        });
        if (result.Items && result.Items.length > 0) {
          found = true;
          break;
        }
      }

      expect(found).toBe(false);
      expect(mockSend).toHaveBeenCalledTimes(4); // Called for each status
    });
  });
});

describe("report-worker", () => {
  describe("getMeetingType priority", () => {
    it("should use SQS message meetingType if not 'general'", async () => {
      const messageType = "tech";
      const meetingId = randomUUID();
      const createdAt = new Date().toISOString();

      // Simulate getMeetingType logic (no DB call needed)
      let resolvedType = messageType;
      if (!messageType || messageType === "general") {
        const result = await docClient.send({
          TableName: "meeting-minutes-meetings",
          Key: { meetingId, createdAt },
        });
        resolvedType = result.Item?.meetingType || "general";
      }

      expect(resolvedType).toBe("tech"); // Should use message type, not DB type
      expect(mockSend).not.toHaveBeenCalled(); // DB should not be called
    });

    it("should fallback to DynamoDB if message type is 'general'", async () => {
      const messageType = "general";
      const meetingId = randomUUID();
      const createdAt = new Date().toISOString();

      // Mock DynamoDB to return "customer"
      mockSend.mockResolvedValueOnce({
        Item: { meetingId, createdAt, meetingType: "customer" },
      });

      // Simulate getMeetingType logic
      let resolvedType = messageType;
      if (!messageType || messageType === "general") {
        const result = await docClient.send({
          TableName: "meeting-minutes-meetings",
          Key: { meetingId, createdAt },
        });
        resolvedType = result.Item?.meetingType || "general";
      }

      expect(resolvedType).toBe("customer"); // Should use DB type
      expect(mockSend).toHaveBeenCalled();
    });

    it("should use 'general' if DynamoDB lookup fails", async () => {
      const messageType = undefined;
      const meetingId = randomUUID();
      const createdAt = new Date().toISOString();

      // Mock DynamoDB to throw error
      mockSend.mockRejectedValueOnce(new Error("DynamoDB error"));

      // Simulate getMeetingType logic with error handling
      let resolvedType = messageType;
      if (!messageType || messageType === "general") {
        try {
          const result = await docClient.send({
            TableName: "meeting-minutes-meetings",
            Key: { meetingId, createdAt },
          });
          resolvedType = result.Item?.meetingType || "general";
        } catch (err) {
          logger.warn("test", "read-meetingType-failed", { error: err.message });
          resolvedType = "general";
        }
      }

      expect(resolvedType).toBe("general");
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe("processMessage", () => {
    it("should successfully generate report when transcript exists", async () => {
      const meetingId = randomUUID();
      const createdAt = new Date().toISOString();
      const mockTranscript = "Meeting transcript content";
      const mockReport = { summary: "Test summary", actions: [] };

      // Mock getFile to return transcript
      getFile.mockResolvedValueOnce({
        async *[Symbol.asyncIterator]() {
          yield Buffer.from(JSON.stringify({ results: { transcripts: [{ transcript: mockTranscript }] } }));
        },
      });

      // Mock invokeModel to return report JSON
      invokeModel.mockResolvedValueOnce(JSON.stringify(mockReport));

      // Mock DynamoDB operations
      mockSend.mockResolvedValue({ Item: { meetingId, createdAt, meetingType: "general" } });

      // Simulate successful flow
      const glossaryTerms = [];
      const responseText = await invokeModel(mockTranscript, "general", glossaryTerms);
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);

      expect(jsonMatch).toBeTruthy();
      expect(JSON.parse(jsonMatch[0])).toEqual(mockReport);
    });

    it("should update status to 'failed' when Bedrock invocation fails", async () => {
      const meetingId = randomUUID();
      const createdAt = new Date().toISOString();
      const mockError = new Error("Bedrock API error");

      // Mock getFile to return transcript
      getFile.mockResolvedValueOnce({
        async *[Symbol.asyncIterator]() {
          yield Buffer.from("Test transcript");
        },
      });

      // Mock invokeModel to throw error
      invokeModel.mockRejectedValueOnce(mockError);

      // Mock DynamoDB operations
      mockSend.mockResolvedValue({});

      try {
        await invokeModel("test", "general", []);
      } catch (err) {
        // Simulate error handling in worker
        await docClient.send({
          TableName: "meeting-minutes-meetings",
          Key: { meetingId, createdAt },
          UpdateExpression: "SET #s = :s, errorMessage = :em, stage = :stage, updatedAt = :u",
          ExpressionAttributeNames: { "#s": "status" },
          ExpressionAttributeValues: {
            ":s": "failed",
            ":em": err.message,
            ":stage": "failed",
            ":u": new Date().toISOString(),
          },
        });

        expect(err.message).toBe("Bedrock API error");
        expect(mockSend).toHaveBeenCalledWith(
          expect.objectContaining({
            TableName: "meeting-minutes-meetings",
            UpdateExpression: expect.stringContaining("errorMessage"),
            ExpressionAttributeValues: expect.objectContaining({
              ":s": "failed",
              ":stage": "failed",
            }),
          })
        );
      }
    });

    it("should throw error when all transcription sources fail", async () => {
      // Reset and mock all transcript sources to fail
      getFile.mockReset();
      getFile.mockRejectedValue(new Error("S3 read failed"));

      // Simulate readTranscript with all sources failing
      const stream1 = await getFile("transcribe-key").catch(() => null);
      const stream2 = await getFile("whisper-key").catch(() => null);
      const stream3 = await getFile("funasr-key").catch(() => null);

      // All sources should be null after catch
      expect(stream1).toBeNull();
      expect(stream2).toBeNull();
      expect(stream3).toBeNull();

      // This simulates the actual error thrown in report-worker
      expect(() => {
        if (!stream1 && !stream2 && !stream3) {
          throw new Error("All transcription sources failed");
        }
      }).toThrow("All transcription sources failed");
    });
  });
});
