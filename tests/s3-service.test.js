// Set environment variables before module is loaded
process.env.S3_PREFIX = "meeting-minutes"
process.env.S3_BUCKET = "test-bucket"
process.env.AWS_REGION = "us-west-2"

const mockSend = jest.fn()

// Mock the S3Client so the module-level `s3` instance uses our mock send
jest.mock("@aws-sdk/client-s3", () => {
  return {
    S3Client: jest.fn().mockImplementation(() => ({ send: mockSend })),
    PutObjectCommand: jest.fn((params) => ({ ...params, _cmd: "PutObjectCommand" })),
    GetObjectCommand: jest.fn((params) => ({ ...params, _cmd: "GetObjectCommand" })),
    DeleteObjectCommand: jest.fn((params) => ({ ...params, _cmd: "DeleteObjectCommand" })),
  }
})

const { uploadFile, getFile, deleteObject, uploadStream } = require("../services/s3")
const { Readable } = require("stream")

describe("s3-service", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe("uploadFile", () => {
    it("should upload file to S3 with prefix and return bare key", async () => {
      mockSend.mockResolvedValueOnce({})

      const result = await uploadFile("inbox/test.mp3", Buffer.from("audio"), "audio/mpeg")

      expect(result).toBe("inbox/test.mp3")
      expect(mockSend).toHaveBeenCalledTimes(1)
      const callArg = mockSend.mock.calls[0][0]
      expect(callArg.Bucket).toBe("test-bucket")
      expect(callArg.Key).toBe("meeting-minutes/inbox/test.mp3")
      expect(callArg.ContentType).toBe("audio/mpeg")
    })

    it("should convert string body to Buffer for correct UTF-8 encoding", async () => {
      mockSend.mockResolvedValueOnce({})
      const chineseJson = JSON.stringify({ summary: "会议总结：讨论了项目进展" }, null, 2)
      await uploadFile("reports/test/report.json", chineseJson, "application/json")

      const callArg = mockSend.mock.calls[0][0]
      expect(Buffer.isBuffer(callArg.Body)).toBe(true)
      expect(callArg.Body.toString("utf-8")).toBe(chineseJson)
    })

    it("should handle empty body", async () => {
      mockSend.mockResolvedValueOnce({})
      const result = await uploadFile("inbox/empty.txt", "", "text/plain")
      expect(result).toBe("inbox/empty.txt")
      const callArg = mockSend.mock.calls[0][0]
      expect(Buffer.isBuffer(callArg.Body)).toBe(true)
      expect(callArg.Body.length).toBe(0)
    })

    it("should handle missing content type", async () => {
      mockSend.mockResolvedValueOnce({})
      const result = await uploadFile("inbox/file.bin", Buffer.from("data"))
      expect(result).toBe("inbox/file.bin")
      const callArg = mockSend.mock.calls[0][0]
      expect(callArg.ContentType).toBeUndefined()
    })

    it("should propagate S3 errors", async () => {
      mockSend.mockRejectedValueOnce(new Error("S3 upload failed"))
      await expect(uploadFile("inbox/test.mp3", Buffer.from("audio"), "audio/mpeg"))
        .rejects.toThrow("S3 upload failed")
    })
  })

  describe("getFile", () => {
    it("should get file from S3 with bare key", async () => {
      const mockBody = Buffer.from("file content")
      mockSend.mockResolvedValueOnce({ Body: mockBody })

      const result = await getFile("reports/test.json")

      expect(result).toBe(mockBody)
      const callArg = mockSend.mock.calls[0][0]
      expect(callArg.Bucket).toBe("test-bucket")
      expect(callArg.Key).toBe("meeting-minutes/reports/test.json")
    })

    it("should handle key that already contains prefix", async () => {
      const mockBody = Buffer.from("file content")
      mockSend.mockResolvedValueOnce({ Body: mockBody })

      const result = await getFile("meeting-minutes/reports/test.json")

      expect(result).toBe(mockBody)
      const callArg = mockSend.mock.calls[0][0]
      expect(callArg.Key).toBe("meeting-minutes/reports/test.json")
    })

    it("should return Body from response", async () => {
      const mockStream = Buffer.from("stream data")
      mockSend.mockResolvedValueOnce({ Body: mockStream })
      const result = await getFile("test.json")
      expect(result).toBe(mockStream)
    })

    it("should propagate S3 errors", async () => {
      mockSend.mockRejectedValueOnce(new Error("S3 get failed"))
      await expect(getFile("reports/test.json")).rejects.toThrow("S3 get failed")
    })

    it("should handle NoSuchKey error", async () => {
      const error = new Error("NoSuchKey")
      error.name = "NoSuchKey"
      mockSend.mockRejectedValueOnce(error)
      await expect(getFile("nonexistent.json")).rejects.toThrow("NoSuchKey")
    })
  })

  describe("deleteObject", () => {
    it("should delete object from S3", async () => {
      mockSend.mockResolvedValueOnce({})

      await deleteObject("inbox/test.mp3")

      expect(mockSend).toHaveBeenCalledTimes(1)
      const callArg = mockSend.mock.calls[0][0]
      expect(callArg.Bucket).toBe("test-bucket")
      expect(callArg.Key).toBe("meeting-minutes/inbox/test.mp3")
    })

    it("should handle key with prefix", async () => {
      mockSend.mockResolvedValueOnce({})

      await deleteObject("meeting-minutes/inbox/test.mp3")

      const callArg = mockSend.mock.calls[0][0]
      expect(callArg.Key).toBe("meeting-minutes/inbox/test.mp3")
    })

    it("should skip deletion when key is empty", async () => {
      await deleteObject("")
      expect(mockSend).not.toHaveBeenCalled()
    })

    it("should skip deletion when key is null", async () => {
      await deleteObject(null)
      expect(mockSend).not.toHaveBeenCalled()
    })

    it("should propagate S3 errors", async () => {
      mockSend.mockRejectedValueOnce(new Error("S3 delete failed"))
      await expect(deleteObject("inbox/test.mp3")).rejects.toThrow("S3 delete failed")
    })
  })

  describe("uploadStream", () => {
    it("should upload stream to S3", async () => {
      mockSend.mockResolvedValueOnce({})
      const stream = Readable.from(["test data"])

      const result = await uploadStream("inbox/stream.mp3", stream, "audio/mpeg")

      expect(result).toBe("inbox/stream.mp3")
      const callArg = mockSend.mock.calls[0][0]
      expect(callArg.Bucket).toBe("test-bucket")
      expect(callArg.Key).toBe("meeting-minutes/inbox/stream.mp3")
      expect(callArg.ContentType).toBe("audio/mpeg")
    })

    it("should propagate S3 errors", async () => {
      mockSend.mockRejectedValueOnce(new Error("S3 stream upload failed"))
      const stream = Readable.from(["test data"])
      await expect(uploadStream("inbox/stream.mp3", stream, "audio/mpeg"))
        .rejects.toThrow("S3 stream upload failed")
    })
  })
})
