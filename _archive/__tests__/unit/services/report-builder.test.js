const { extractJsonFromLLMResponse } = require("../../../services/report-builder");

describe("extractJsonFromLLMResponse", () => {
  it("should extract JSON from plain response", () => {
    const input = '{"summary": "会议总结", "actions": []}';
    const result = extractJsonFromLLMResponse(input);
    expect(result).toEqual({ summary: "会议总结", actions: [] });
  });

  it("should extract JSON from markdown code block", () => {
    const input = '```json\n{"summary": "会议总结", "actions": []}\n```';
    const result = extractJsonFromLLMResponse(input);
    expect(result).toEqual({ summary: "会议总结", actions: [] });
  });

  it("should extract JSON from text with surrounding content", () => {
    const input = 'Here is the report: {"summary": "会议总结", "actions": []} End of report.';
    const result = extractJsonFromLLMResponse(input);
    expect(result).toEqual({ summary: "会议总结", actions: [] });
  });

  it("should handle JSON with CJK characters and newlines", () => {
    const input = `{
      "summary": "这是一个会议\\n总结内容",
      "actions": ["完成任务A", "完成任务B"]
    }`;
    const result = extractJsonFromLLMResponse(input);
    expect(result.summary).toBe("这是一个会议\n总结内容");
    expect(result.actions).toEqual(["完成任务A", "完成任务B"]);
  });

  it("should handle JSON with control characters", () => {
    const input = '{"summary": "会议总结\x00\x01\x02", "actions": []}';
    const result = extractJsonFromLLMResponse(input);
    expect(result).toEqual({ summary: "会议总结", actions: [] });
  });

  it("should throw error when no JSON found", () => {
    const input = "This is plain text without any JSON";
    expect(() => extractJsonFromLLMResponse(input)).toThrow("no JSON object found");
  });

  it("should throw error for invalid input", () => {
    expect(() => extractJsonFromLLMResponse(null)).toThrow("Invalid input");
    expect(() => extractJsonFromLLMResponse("")).toThrow("Invalid input");
    expect(() => extractJsonFromLLMResponse(123)).toThrow("Invalid input");
  });

  it("should throw error for malformed JSON", () => {
    const input = '{"summary": "unclosed string';
    expect(() => extractJsonFromLLMResponse(input)).toThrow("Failed to parse Bedrock JSON response");
  });

  it("should handle nested objects with CJK content", () => {
    const input = `{
      "summary": "会议总结",
      "participants": [
        {"name": "张三", "role": "主持人"},
        {"name": "李四", "role": "参与者"}
      ]
    }`;
    const result = extractJsonFromLLMResponse(input);
    expect(result.participants).toHaveLength(2);
    expect(result.participants[0].name).toBe("张三");
  });

  it("should handle markdown code block without json marker", () => {
    const input = '```\n{"summary": "会议总结"}\n```';
    // Should fall back to regex extraction
    const result = extractJsonFromLLMResponse(input);
    expect(result).toEqual({ summary: "会议总结" });
  });
});
