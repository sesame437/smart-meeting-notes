process.env.S3_PREFIX = "meeting-minutes"
process.env.S3_BUCKET = "test-bucket"
process.env.AWS_REGION = "us-west-2"

const mockSend = jest.fn()

jest.mock("@aws-sdk/client-s3", () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send: mockSend })),
  PutObjectCommand: jest.fn((params) => ({ ...params, _cmd: "PutObjectCommand" })),
  GetObjectCommand: jest.fn((params) => ({ ...params, _cmd: "GetObjectCommand" })),
  DeleteObjectCommand: jest.fn((params) => ({ ...params, _cmd: "DeleteObjectCommand" })),
}))

const { uploadFile } = require("../services/s3")

describe("S3 UTF-8 encoding round-trip", () => {
  beforeEach(() => jest.clearAllMocks())

  it("should preserve Chinese characters in JSON upload", async () => {
    const report = {
      summary: "本次会议讨论了AWS GenAI项目进展",
      participants: ["张三", "李四"],
      highlights: [{ point: "完成POC演示", detail: "客户反馈积极" }],
    }
    const jsonStr = JSON.stringify(report, null, 2)

    mockSend.mockResolvedValueOnce({})
    await uploadFile("reports/test-id/report.json", jsonStr, "application/json")

    const callArg = mockSend.mock.calls[0][0]
    expect(Buffer.isBuffer(callArg.Body)).toBe(true)

    const decoded = callArg.Body.toString("utf-8")
    const parsed = JSON.parse(decoded)
    expect(parsed.summary).toBe("本次会议讨论了AWS GenAI项目进展")
    expect(parsed.participants).toEqual(["张三", "李四"])
  })

  it("should correctly calculate byte length for multi-byte chars", async () => {
    const text = "会议"
    mockSend.mockResolvedValueOnce({})
    await uploadFile("test.txt", text, "text/plain")

    const callArg = mockSend.mock.calls[0][0]
    expect(callArg.Body.length).toBe(Buffer.byteLength(text, "utf-8"))
    expect(callArg.Body.length).toBe(6)
  })

  it("should pass Buffer body through unchanged", async () => {
    const buf = Buffer.from("already a buffer")
    mockSend.mockResolvedValueOnce({})
    await uploadFile("test.bin", buf, "application/octet-stream")

    const callArg = mockSend.mock.calls[0][0]
    expect(callArg.Body).toBe(buf)
  })
})
