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
  }
})

const { uploadFile, getFile } = require("../services/s3")

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

    it("should handle empty body", async () => {
      mockSend.mockResolvedValueOnce({})
      const result = await uploadFile("inbox/empty.txt", "", "text/plain")
      expect(result).toBe("inbox/empty.txt")
      const callArg = mockSend.mock.calls[0][0]
      expect(callArg.Body).toBe("")
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
})
