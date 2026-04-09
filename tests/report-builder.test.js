const { repairJsonQuotes, extractJsonFromLLMResponse } = require("../services/report-builder")

describe("repairJsonQuotes", () => {
  it("passes through clean JSON unchanged", () => {
    const input = '{"key": "value", "num": 42}'
    expect(repairJsonQuotes(input)).toBe(input)
  })

  it("escapes unescaped double quotes in Chinese text", () => {
    const input = '{"topic": "核心逻辑是"谁"的问题"}'
    const result = repairJsonQuotes(input)
    expect(() => JSON.parse(result)).not.toThrow()
    expect(JSON.parse(result).topic).toBe('核心逻辑是"谁"的问题')
  })

  it("handles multiple unescaped quotes in one string", () => {
    const input = '{"text": "他说"你好"然后又说"再见"结束了"}'
    const result = repairJsonQuotes(input)
    expect(() => JSON.parse(result)).not.toThrow()
    expect(JSON.parse(result).text).toBe('他说"你好"然后又说"再见"结束了')
  })

  it("preserves already-escaped quotes", () => {
    const input = '{"text": "already \\"escaped\\" here"}'
    const result = repairJsonQuotes(input)
    expect(() => JSON.parse(result)).not.toThrow()
    expect(JSON.parse(result).text).toBe('already "escaped" here')
  })

  it("handles nested objects", () => {
    const input = '{"outer": {"inner": "含有"引号"的值"}}'
    const result = repairJsonQuotes(input)
    expect(() => JSON.parse(result)).not.toThrow()
    expect(JSON.parse(result).outer.inner).toBe('含有"引号"的值')
  })

  it("handles arrays of strings", () => {
    const input = '{"items": ["正常值", "含"引号"值", "另一个"]}'
    const result = repairJsonQuotes(input)
    expect(() => JSON.parse(result)).not.toThrow()
    const parsed = JSON.parse(result)
    expect(parsed.items).toHaveLength(3)
    expect(parsed.items[1]).toBe('含"引号"值')
  })

  it("handles closing quote followed by newline then structural token", () => {
    const input = '{"key": "value"\n}'
    const result = repairJsonQuotes(input)
    expect(() => JSON.parse(result)).not.toThrow()
  })

  it("handles closing quote followed by \\r\\n then comma", () => {
    const input = '{"a": "one"\r\n, "b": "two"}'
    const result = repairJsonQuotes(input)
    expect(() => JSON.parse(result)).not.toThrow()
  })

  it("handles empty strings", () => {
    const input = '{"key": ""}'
    const result = repairJsonQuotes(input)
    expect(result).toBe(input)
    expect(JSON.parse(result).key).toBe("")
  })

  it("handles string ending at end of input", () => {
    const input = '{"key": "value"}'
    const result = repairJsonQuotes(input)
    expect(result).toBe(input)
  })
})

describe("extractJsonFromLLMResponse", () => {
  it("throws on empty input", () => {
    expect(() => extractJsonFromLLMResponse("")).toThrow("Invalid input")
    expect(() => extractJsonFromLLMResponse(null)).toThrow("Invalid input")
  })

  it("parses clean JSON directly", () => {
    const json = '{"summary": "test", "topics": []}'
    expect(extractJsonFromLLMResponse(json)).toEqual({ summary: "test", topics: [] })
  })

  it("extracts JSON from markdown code block", () => {
    const text = 'Here is the result:\n```json\n{"key": "value"}\n```\nDone.'
    expect(extractJsonFromLLMResponse(text)).toEqual({ key: "value" })
  })

  it("extracts JSON embedded in surrounding text", () => {
    const text = 'The report is: {"summary": "会议总结"} end.'
    expect(extractJsonFromLLMResponse(text)).toEqual({ summary: "会议总结" })
  })

  it("handles control characters in JSON", () => {
    const text = '{"key": "val\x01ue"}'
    expect(extractJsonFromLLMResponse(text)).toEqual({ key: "value" })
  })

  it("handles newlines inside JSON strings by collapsing to spaces", () => {
    const text = '{"key": "line1\nline2"}'
    expect(extractJsonFromLLMResponse(text)).toEqual({ key: "line1 line2" })
  })

  it("repairs unescaped quotes in LLM output", () => {
    const text = '{"topic": "核心逻辑是"谁"的问题"}'
    const result = extractJsonFromLLMResponse(text)
    expect(result.topic).toBe('核心逻辑是"谁"的问题')
  })

  it("throws when no JSON object found", () => {
    expect(() => extractJsonFromLLMResponse("no json here")).toThrow("no JSON object found")
  })

  it("throws when JSON is unrecoverable", () => {
    expect(() => extractJsonFromLLMResponse("{{{invalid")).toThrow("Failed to parse")
  })
})
