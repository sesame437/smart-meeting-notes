const mockSend = jest.fn()

jest.mock("@aws-sdk/client-bedrock-runtime", () => {
  return {
    BedrockRuntimeClient: jest.fn().mockImplementation(() => ({
      send: mockSend,
    })),
    InvokeModelCommand: jest.fn((input) => ({ input })),
  }
})

const { invokeModel, getMeetingPrompt } = require("../services/bedrock")

describe("bedrock-service", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe("getMeetingPrompt", () => {
    it("should return weekly meeting prompt for weekly type", () => {
      const result = getMeetingPrompt("Test transcript", "weekly")

      expect(result).toContain("AWS SA 团队周例会")
      expect(result).toContain('"meetingType": "weekly"')
      expect(result).toContain("teamKPI")
      expect(result).toContain("projectReviews")
    })

    it("should return tech meeting prompt for tech type", () => {
      const result = getMeetingPrompt("Test transcript", "tech")

      expect(result).toContain("技术讨论会")
      expect(result).toContain('"meetingType": "tech"')
      expect(result).toContain("techStack")
      expect(result).toContain("knowledgeBase")
    })

    it("should return customer meeting prompt for customer type", () => {
      const result = getMeetingPrompt("Test transcript", "customer")

      expect(result).toContain("客户会议")
      expect(result).toContain('"meetingType": "customer"')
      expect(result).toContain("customerInfo")
      expect(result).toContain("customerNeeds")
    })

    it("should return merged meeting prompt for merged type", () => {
      const result = getMeetingPrompt("Test transcript", "merged")

      expect(result).toContain('"meetingType": "merged"')
      expect(result).toContain("sourceMeetings")
      expect(result).toContain("综合汇总报告")
    })

    it("should return general prompt for default type", () => {
      const result = getMeetingPrompt("Test transcript", "general")

      expect(result).toContain("会议纪要助手")
      expect(result).toContain('"summary"')
      expect(result).toContain('"topics"')
    })

    it("should include speaker mapping when speakerMap provided", () => {
      const speakerMap = { SPEAKER_01: "张三", SPEAKER_02: "李四" }
      const result = getMeetingPrompt("Test transcript", "general", [], speakerMap)

      expect(result).toContain("真实姓名映射")
      expect(result).toContain("SPEAKER_01: 张三")
      expect(result).toContain("SPEAKER_02: 李四")
    })

    it("should include speaker inference note when transcript has SPEAKER tags but no speakerMap", () => {
      const result = getMeetingPrompt("[SPEAKER_0] Hello [SPEAKER_1] Hi", "general")

      expect(result).toContain("说话人标签")
      expect(result).toContain("推断其身份")
      expect(result).not.toContain("真实姓名映射")
    })

    it("should include glossary terms when provided", () => {
      const glossaryTerms = ["DynamoDB", "Lambda", "CloudWatch"]
      const result = getMeetingPrompt("Test transcript", "general", glossaryTerms)

      expect(result).toContain("专有名词词库")
      expect(result).toContain("DynamoDB")
      expect(result).toContain("Lambda")
      expect(result).toContain("CloudWatch")
    })

    it("should not include glossary note when glossaryTerms is empty", () => {
      const result = getMeetingPrompt("Test transcript", "general", [])

      expect(result).not.toContain("专有名词词库")
    })

    it("should include custom prompt for merged type", () => {
      const customPrompt = "重点关注预算和时间节点"
      const result = getMeetingPrompt("Test transcript", "merged", [], null, customPrompt)

      expect(result).toContain("用户额外要求")
      expect(result).toContain(customPrompt)
    })
  })

  describe("invokeModel", () => {
    it("should invoke Bedrock model and return text response", async () => {
      const mockResponse = {
        body: new TextEncoder().encode(
          JSON.stringify({
            content: [{ text: '{"summary": "Meeting summary"}' }],
          })
        ),
      }
      mockSend.mockResolvedValueOnce(mockResponse)

      const result = await invokeModel("Test transcript", "general")

      expect(result).toBe('{"summary": "Meeting summary"}')
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            modelId: "global.anthropic.claude-sonnet-4-6",
            contentType: "application/json",
            accept: "application/json",
          }),
        })
      )
    })

    it("should use custom modelId when provided", async () => {
      const mockResponse = {
        body: new TextEncoder().encode(
          JSON.stringify({
            content: [{ text: "Response" }],
          })
        ),
      }
      mockSend.mockResolvedValueOnce(mockResponse)

      await invokeModel("Test", "general", [], "custom-model-id")

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            modelId: "custom-model-id",
          }),
        })
      )
    })

    it("should pass glossaryTerms to prompt generation", async () => {
      const mockResponse = {
        body: new TextEncoder().encode(
          JSON.stringify({
            content: [{ text: "Response" }],
          })
        ),
      }
      mockSend.mockResolvedValueOnce(mockResponse)
      const glossaryTerms = ["Term1", "Term2"]

      await invokeModel("Test", "general", glossaryTerms)

      const callBody = JSON.parse(mockSend.mock.calls[0][0].input.body)
      expect(callBody.messages[0].content).toContain("Term1")
      expect(callBody.messages[0].content).toContain("Term2")
    })

    it("should pass speakerMap to prompt generation", async () => {
      const mockResponse = {
        body: new TextEncoder().encode(
          JSON.stringify({
            content: [{ text: "Response" }],
          })
        ),
      }
      mockSend.mockResolvedValueOnce(mockResponse)
      const speakerMap = { SPEAKER_01: "Alice" }

      await invokeModel("Test", "general", [], "global.anthropic.claude-sonnet-4-6", speakerMap)

      const callBody = JSON.parse(mockSend.mock.calls[0][0].input.body)
      expect(callBody.messages[0].content).toContain("真实姓名映射")
      expect(callBody.messages[0].content).toContain("Alice")
    })

    it("should truncate transcript if too long", async () => {
      const mockResponse = {
        body: new TextEncoder().encode(
          JSON.stringify({
            content: [{ text: "Response" }],
          })
        ),
      }
      mockSend.mockResolvedValueOnce(mockResponse)
      const longTranscript = "a".repeat(200000)

      await invokeModel(longTranscript, "general")

      const callBody = JSON.parse(mockSend.mock.calls[0][0].input.body)
      expect(callBody.messages[0].content.length).toBeLessThan(longTranscript.length + 1000)
    })

    it("should handle JSON parsing errors", async () => {
      const mockResponse = {
        body: new TextEncoder().encode("invalid json"),
      }
      mockSend.mockResolvedValueOnce(mockResponse)

      await expect(invokeModel("Test", "general")).rejects.toThrow()
    })

    it("should propagate Bedrock errors", async () => {
      const error = new Error("Bedrock invocation failed")
      mockSend.mockRejectedValueOnce(error)

      await expect(invokeModel("Test", "general")).rejects.toThrow("Bedrock invocation failed")
    })

    it("should handle throttling errors", async () => {
      const error = new Error("ThrottlingException")
      error.name = "ThrottlingException"
      mockSend.mockRejectedValueOnce(error)

      await expect(invokeModel("Test", "general")).rejects.toThrow("ThrottlingException")
    })

    it("should send correct anthropic_version and max_tokens", async () => {
      const mockResponse = {
        body: new TextEncoder().encode(
          JSON.stringify({
            content: [{ text: "Response" }],
          })
        ),
      }
      mockSend.mockResolvedValueOnce(mockResponse)

      await invokeModel("Test", "general")

      const callBody = JSON.parse(mockSend.mock.calls[0][0].input.body)
      expect(callBody.anthropic_version).toBe("bedrock-2023-05-31")
      expect(callBody.max_tokens).toBe(32000)
    })
  })
})
