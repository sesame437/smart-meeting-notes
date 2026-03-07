const mockGetFile = jest.fn();
const mockQueryMeetingById = jest.fn();

jest.mock("../services/s3", () => ({
  getFile: mockGetFile,
}));

jest.mock("../services/meeting-store", () => ({
  queryMeetingById: mockQueryMeetingById,
}));

const {
  validateIdParam,
  sanitizeFilename,
  getMeetingById,
  validateSpeakerMap,
  readTranscriptParts,
} = require("../routes/meetings/helpers");

describe("meetings-helpers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("validateIdParam", () => {
    it("should call next() for valid id", () => {
      const req = { params: { id: "valid-id-123" } };
      const res = {};
      const next = jest.fn();

      validateIdParam(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it("should return 400 for empty id", () => {
      const req = { params: { id: "" } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      validateIdParam(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        error: expect.objectContaining({ code: "INVALID_ID" }),
      }));
      expect(next).not.toHaveBeenCalled();
    });

    it("should return 400 for id longer than 100 chars", () => {
      const req = { params: { id: "a".repeat(101) } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      validateIdParam(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe("sanitizeFilename", () => {
    it("should replace special characters with underscore", () => {
      expect(sanitizeFilename("test file!@#.mp3")).toBe("test_file___.mp3");
    });

    it("should truncate to 200 chars", () => {
      const longName = "a".repeat(250) + ".mp3";
      const result = sanitizeFilename(longName);
      expect(result.length).toBe(200);
    });

    it("should replace multiple dots with underscore", () => {
      expect(sanitizeFilename("test...file.mp3")).toBe("test_file.mp3");
    });
  });

  describe("getMeetingById", () => {
    it("should return meeting from store", async () => {
      const mockMeeting = { meetingId: "123", title: "Test" };
      mockQueryMeetingById.mockResolvedValueOnce(mockMeeting);

      const result = await getMeetingById("123");

      expect(result).toEqual(mockMeeting);
      expect(mockQueryMeetingById).toHaveBeenCalledWith("123");
    });
  });

  describe("validateSpeakerMap", () => {
    it("should return null for valid speakerMap", () => {
      const result = validateSpeakerMap({ SPEAKER_0: "Alice", SPEAKER_1: "Bob" });
      expect(result).toBeNull();
    });

    it("should return error for non-object", () => {
      expect(validateSpeakerMap(null)).toContain("must be an object");
      expect(validateSpeakerMap([])).toContain("must be an object");
      expect(validateSpeakerMap("string")).toContain("must be an object");
    });

    it("should return error for empty object", () => {
      expect(validateSpeakerMap({})).toContain("cannot be empty");
    });

    it("should return error for invalid key", () => {
      expect(validateSpeakerMap({ "": "Alice" })).toContain("non-empty string");
      expect(validateSpeakerMap({ ["a".repeat(201)]: "Alice" })).toContain("non-empty string");
    });

    it("should return error for non-string value", () => {
      expect(validateSpeakerMap({ SPEAKER_0: 123 })).toContain("must be strings");
    });

    it("should return error for value longer than 100 chars", () => {
      expect(validateSpeakerMap({ SPEAKER_0: "a".repeat(101) })).toContain("at most 100 characters");
    });
  });

  describe("readTranscriptParts", () => {
    it("should return empty array when no transcript keys", async () => {
      const result = await readTranscriptParts({});
      expect(result).toEqual([]);
    });

    it("should read transcribeKey as JSON", async () => {
      const mockData = { results: { transcripts: [{ transcript: "Test transcript" }] } };
      mockGetFile.mockResolvedValueOnce((async function* () {
        yield Buffer.from(JSON.stringify(mockData));
      })());

      const result = await readTranscriptParts({ transcribeKey: "s3://bucket/transcribe.json" });

      expect(result).toHaveLength(1);
      expect(result[0]).toContain("AWS Transcribe");
      expect(result[0]).toContain("Test transcript");
    });

    it("should read whisperKey as text", async () => {
      mockGetFile.mockResolvedValueOnce((async function* () {
        yield Buffer.from("Whisper transcript text");
      })());

      const result = await readTranscriptParts({ whisperKey: "s3://bucket/whisper.txt" });

      expect(result).toHaveLength(1);
      expect(result[0]).toContain("Whisper 转录");
      expect(result[0]).toContain("Whisper transcript text");
    });

    it("should read funasrKey with segments", async () => {
      const mockData = {
        segments: [
          { speaker: "SPEAKER_0", text: "Hello " },
          { speaker: "SPEAKER_0", text: "world" },
          { speaker: "SPEAKER_1", text: "Hi there" },
        ],
      };
      mockGetFile.mockResolvedValueOnce((async function* () {
        yield Buffer.from(JSON.stringify(mockData));
      })());

      const result = await readTranscriptParts({ funasrKey: "s3://bucket/funasr.json" });

      expect(result).toHaveLength(1);
      expect(result[0]).toContain("FunASR 转录");
      expect(result[0]).toContain("[SPEAKER_0] Hello world");
      expect(result[0]).toContain("[SPEAKER_1] Hi there");
    });

    it("should handle getFile errors gracefully", async () => {
      mockGetFile.mockRejectedValueOnce(new Error("S3 error"));

      const result = await readTranscriptParts({ transcribeKey: "s3://bucket/missing.json" });

      expect(result).toEqual([]);
    });
  });
});
