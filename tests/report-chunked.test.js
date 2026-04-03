const mockInvokeModelRaw = jest.fn()

jest.mock("../services/bedrock", () => ({
  invokeModelRaw: (...args) => mockInvokeModelRaw(...args),
  invokeModel: jest.fn(),
  getMeetingPrompt: jest.fn(),
}))

const { generateReportChunked, buildPhase1Prompt, buildPhase2Prompt, buildPhase3Prompt } = require("../services/report-chunked")

describe("report-chunked", () => {
  beforeEach(() => jest.clearAllMocks())

  describe("prompt builders", () => {
    it("phase1 prompt should request metadata fields only", () => {
      const prompt = buildPhase1Prompt("[SPEAKER_0] test", [], null)
      expect(prompt).toContain("summary")
      expect(prompt).toContain("teamKPI")
      expect(prompt).toContain("announcements")
      expect(prompt).toContain("decisions")
      expect(prompt).not.toContain('"projectReviews"')
      expect(prompt).not.toContain('"actions"')
    })

    it("phase2 prompt should request only projectReviews", () => {
      const prompt = buildPhase2Prompt("[SPEAKER_0] test", [], null)
      expect(prompt).toContain("projectReviews")
      expect(prompt).not.toContain('"teamKPI"')
      expect(prompt).not.toContain('"actions"')
    })

    it("phase3 prompt should request actions/highlights/lowlights", () => {
      const prompt = buildPhase3Prompt("[SPEAKER_0] test", [], null)
      expect(prompt).toContain("actions")
      expect(prompt).toContain("highlights")
      expect(prompt).toContain("lowlights")
      expect(prompt).not.toContain('"projectReviews"')
    })

    it("should include speaker note when transcript has SPEAKER_ labels", () => {
      const prompt = buildPhase1Prompt("[SPEAKER_0] hello", [], null)
      expect(prompt).toContain("说话人标签")
    })

    it("should include glossary when provided", () => {
      const prompt = buildPhase1Prompt("test", ["AWS", "Bedrock"], null)
      expect(prompt).toContain("AWS")
      expect(prompt).toContain("Bedrock")
    })
  })

  describe("generateReportChunked", () => {
    const phase1Response = JSON.stringify({
      meetingType: "weekly",
      summary: "Test summary",
      participants: ["Alice", "Bob"],
      teamKPI: { overview: "Good", individuals: [{ name: "Alice", kpi: "On track", status: "on-track" }] },
      announcements: [{ title: "News", detail: "Detail", owner: "Alice" }],
      decisions: [{ decision: "Use X", rationale: "Because Y" }],
      nextMeeting: "Next Monday",
      speakerKeypoints: { SPEAKER_0: ["Point 1"] },
    })
    const phase2Response = JSON.stringify({
      projectReviews: [{ project: "Proj A", progress: "Done", followUps: [], highlights: [], lowlights: [], risks: [], challenges: [] }],
    })
    const phase3Response = JSON.stringify({
      actions: [{ task: "Do X", owner: "Alice", deadline: "Friday", priority: "high" }],
      highlights: [{ point: "Good", detail: "Detail" }],
      lowlights: [{ point: "Bad", detail: "Detail" }],
    })

    it("should merge 3 phases into complete report", async () => {
      mockInvokeModelRaw
        .mockResolvedValueOnce(phase1Response)
        .mockResolvedValueOnce(phase2Response)
        .mockResolvedValueOnce(phase3Response)

      const result = await generateReportChunked("[SPEAKER_0] test", "weekly", [])

      expect(result.meetingType).toBe("weekly")
      expect(result.summary).toBe("Test summary")
      expect(result.participants).toEqual(["Alice", "Bob"])
      expect(result.teamKPI.overview).toBe("Good")
      expect(result.announcements).toHaveLength(1)
      expect(result.decisions).toHaveLength(1)
      expect(result.projectReviews).toHaveLength(1)
      expect(result.actions).toHaveLength(1)
      expect(result.highlights).toHaveLength(1)
      expect(result.lowlights).toHaveLength(1)
      expect(result.speakerKeypoints.SPEAKER_0).toEqual(["Point 1"])
      expect(mockInvokeModelRaw).toHaveBeenCalledTimes(3)
    })

    it("should default missing fields to empty arrays/objects", async () => {
      mockInvokeModelRaw
        .mockResolvedValueOnce(JSON.stringify({ meetingType: "weekly", summary: "Sparse" }))
        .mockResolvedValueOnce(JSON.stringify({}))
        .mockResolvedValueOnce(JSON.stringify({}))

      const result = await generateReportChunked("[SPEAKER_0] test", "weekly", [])

      expect(result.summary).toBe("Sparse")
      expect(result.participants).toEqual([])
      expect(result.teamKPI).toEqual({ overview: "", individuals: [] })
      expect(result.projectReviews).toEqual([])
      expect(result.actions).toEqual([])
      expect(result.highlights).toEqual([])
      expect(result.lowlights).toEqual([])
    })

    it("should retry a phase on failure then succeed", async () => {
      mockInvokeModelRaw
        .mockRejectedValueOnce(new Error("Failed to parse Bedrock JSON response"))
        .mockResolvedValueOnce(phase1Response)
        .mockResolvedValueOnce(phase2Response)
        .mockResolvedValueOnce(phase3Response)

      const result = await generateReportChunked("[SPEAKER_0] test", "weekly", [])

      expect(result.summary).toBe("Test summary")
      expect(mockInvokeModelRaw).toHaveBeenCalledTimes(4)
    })

    it("should throw after max retries exhausted", async () => {
      mockInvokeModelRaw
        .mockRejectedValueOnce(new Error("fail 1"))
        .mockRejectedValueOnce(new Error("fail 2"))

      await expect(generateReportChunked("[SPEAKER_0] test", "weekly", []))
        .rejects.toThrow("fail 2")
    })
  })
})
