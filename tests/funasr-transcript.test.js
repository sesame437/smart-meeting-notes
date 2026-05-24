"use strict";

const { buildPlainTranscript } = require("../services/funasr-transcript");

describe("buildPlainTranscript", () => {
  test("returns empty string when funasrJson has no segments and no text", () => {
    expect(buildPlainTranscript({}, {})).toBe("");
    expect(buildPlainTranscript({ segments: [] }, {})).toBe("");
  });

  test("falls back to single line when only text exists, no segments", () => {
    const json = { text: "整段无切分的转录内容" };
    expect(buildPlainTranscript(json, {})).toBe("[SPEAKER_0] 整段无切分的转录内容");
  });

  test("renders one line per segment in original order, no merge", () => {
    const json = {
      segments: [
        { speaker: 0, text: "我们这季度的目标" },
        { speaker: 0, text: "是 P0 全量上线" },
        { speaker: 1, text: "我同意" },
        { speaker: 0, text: "OK" },
      ],
    };
    expect(buildPlainTranscript(json, {})).toBe(
      "[SPEAKER_0] 我们这季度的目标\n" +
        "[SPEAKER_0] 是 P0 全量上线\n" +
        "[SPEAKER_1] 我同意\n" +
        "[SPEAKER_0] OK"
    );
  });

  test("applies speakerMap by raw label", () => {
    const json = {
      segments: [
        { speaker: 0, text: "你好" },
        { speaker: 1, text: "在的" },
      ],
    };
    const speakerMap = { SPEAKER_0: "张三", SPEAKER_1: "李四" };
    expect(buildPlainTranscript(json, speakerMap)).toBe(
      "[张三] 你好\n[李四] 在的"
    );
  });

  test("keeps SPEAKER_X label when speakerMap misses", () => {
    const json = {
      segments: [
        { speaker: 0, text: "A" },
        { speaker: 2, text: "B" },
      ],
    };
    const speakerMap = { SPEAKER_0: "张三" };
    expect(buildPlainTranscript(json, speakerMap)).toBe(
      "[张三] A\n[SPEAKER_2] B"
    );
  });

  test("preserves empty text segments verbatim (no filtering)", () => {
    const json = {
      segments: [
        { speaker: 0, text: "" },
        { speaker: 0, text: "hello" },
      ],
    };
    expect(buildPlainTranscript(json, {})).toBe(
      "[SPEAKER_0] \n[SPEAKER_0] hello"
    );
  });

  test("handles string speaker label (not number) and applies speakerMap", () => {
    const json = {
      segments: [
        { speaker: "SPEAKER_3", text: "x" },
        { speaker: "guest", text: "y" },
      ],
    };
    const speakerMap = { guest: "客人A" };
    expect(buildPlainTranscript(json, speakerMap)).toBe(
      "[SPEAKER_3] x\n[客人A] y"
    );
  });

  test("defaults to SPEAKER_0 when speaker field is missing", () => {
    const json = { segments: [{ text: "无 speaker" }] };
    expect(buildPlainTranscript(json, {})).toBe("[SPEAKER_0] 无 speaker");
  });

  test("does not truncate long output", () => {
    const longText = "x".repeat(500000);
    const json = { segments: [{ speaker: 0, text: longText }] };
    const result = buildPlainTranscript(json, {});
    expect(result.length).toBeGreaterThan(500000);
    expect(result).toBe(`[SPEAKER_0] ${longText}`);
  });

  test("speakerMap parameter is optional (defaults to {})", () => {
    const json = { segments: [{ speaker: 0, text: "a" }] };
    expect(buildPlainTranscript(json)).toBe("[SPEAKER_0] a");
  });
});
