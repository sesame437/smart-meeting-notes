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
    expect(prompt).not.toContain("不要在纪要中引用或推测");
  });

  test("无 map 但有 SPEAKER 标签: owner 规则明确，禁止留空", () => {
    const prompt = getMeetingPrompt(transcriptWithSpeakers, "general", [], null);

    expect(prompt).toContain("禁止留空");
    expect(prompt).toContain("SPEAKER_X");
    expect(prompt).toContain("speakerKeypoints");
    expect(prompt).not.toContain("参会人真实姓名映射");
  });

  test("空 map 但有 SPEAKER 标签: 同上", () => {
    const prompt = getMeetingPrompt(transcriptWithSpeakers, "general", [], {});

    expect(prompt).toContain("禁止留空");
    expect(prompt).not.toContain("参会人真实姓名映射");
  });

  test("无 map 无 SPEAKER 标签: 不引用说话人", () => {
    const prompt = getMeetingPrompt("大家好，今天讨论项目进展", "general", [], null);

    expect(prompt).toContain("没有说话人标签");
    expect(prompt).not.toContain("参会人真实姓名映射");
  });
});
