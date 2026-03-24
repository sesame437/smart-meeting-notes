"use strict";

const { getMeetingPrompt } = require("../services/bedrock");

describe("bedrock speakerMap prompt injection", () => {
  const transcriptWithSpeakers = "[SPEAKER_0] 你好\n[SPEAKER_1] 你好";

  test("有 map: 注入真实姓名映射", () => {
    const prompt = getMeetingPrompt(
      transcriptWithSpeakers,
      "general",
      [],
      { SPEAKER_0: "Alice", SPEAKER_1: "Bob" }
    );

    expect(prompt).toContain("参会人真实姓名映射");
    expect(prompt).toContain("SPEAKER_0: Alice");
    expect(prompt).toContain("SPEAKER_1: Bob");
    expect(prompt).not.toContain("转录文本中包含说话人标签");
  });

  test("无 map: 使用说话人推断提示", () => {
    const prompt = getMeetingPrompt(transcriptWithSpeakers, "general", [], null);

    expect(prompt).toContain("转录文本中包含说话人标签");
    expect(prompt).not.toContain("参会人真实姓名映射");
  });

  test("空 map: 视为无 map，使用说话人推断提示", () => {
    const prompt = getMeetingPrompt(transcriptWithSpeakers, "general", [], {});

    expect(prompt).toContain("转录文本中包含说话人标签");
    expect(prompt).not.toContain("参会人真实姓名映射");
  });
});
