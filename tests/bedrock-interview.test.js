"use strict";

const { buildPhonescreenPrompt, buildLpPrompt } = require("../services/bedrock-interview");

describe("buildPhonescreenPrompt", () => {
  test("includes transcript text in prompt", () => {
    const prompt = buildPhonescreenPrompt("[00:00:05] Hello, can you describe your project?");
    expect(prompt).toContain("[00:00:05]");
  });

  test("requests minimal phonescreen shape: summary + qaList only", () => {
    const prompt = buildPhonescreenPrompt("transcript");
    expect(prompt).toMatch(/"interviewSubType"\s*:\s*"phonescreen"/);
    expect(prompt).toMatch(/"summary"\s*:/);
    expect(prompt).toMatch(/"qaList"\s*:\s*\[/);
  });

  test("explicitly forbids generic meeting fields", () => {
    const prompt = buildPhonescreenPrompt("transcript");
    expect(prompt).not.toMatch(/"candidateInfo"\s*:/);
    expect(prompt).not.toMatch(/"redFlags"\s*:/);
    expect(prompt).not.toMatch(/"recommendation"\s*:/);
    expect(prompt).not.toMatch(/"highlights"\s*:/);
    expect(prompt).not.toMatch(/"lowlights"\s*:/);
    expect(prompt).not.toMatch(/"actions"\s*:/);
    expect(prompt).not.toMatch(/"decisions"\s*:/);
    expect(prompt).not.toMatch(/"participants"\s*:/);
    expect(prompt).not.toContain("lpBlocks");
    expect(prompt).not.toContain("lpAssessment");
    expect(prompt).not.toContain("strengths");
    expect(prompt).not.toContain("improvements");
  });

  test("instructs the model to merge follow-up questions into single qa entries", () => {
    const prompt = buildPhonescreenPrompt("transcript");
    expect(prompt).toMatch(/追问|follow.?up/i);
    expect(prompt).toMatch(/合并|merge/i);
  });

  test("explicitly instructs JSON-only output", () => {
    const prompt = buildPhonescreenPrompt("t");
    expect(prompt).toMatch(/只输出 JSON|Output JSON only/);
  });
});

describe("buildLpPrompt", () => {
  const validLps = ["Ownership", "Dive Deep"];

  test("includes both user-chosen LP names in prompt", () => {
    const prompt = buildLpPrompt("transcript", validLps);
    expect(prompt).toContain("Ownership");
    expect(prompt).toContain("Dive Deep");
  });

  test("requests minimal lp shape: summary + interviewLPs + lpBlocks only", () => {
    const prompt = buildLpPrompt("transcript", validLps);
    expect(prompt).toMatch(/"interviewSubType"\s*:\s*"lp"/);
    expect(prompt).toMatch(/"interviewLPs"\s*:/);
    expect(prompt).toMatch(/"summary"\s*:/);
    expect(prompt).toMatch(/"lpBlocks"\s*:\s*\[/);
  });

  test("each lpBlock has rating, overview, evidence, qaList fields", () => {
    const prompt = buildLpPrompt("transcript", validLps);
    expect(prompt).toMatch(/"rating"\s*:/);
    expect(prompt).toMatch(/"overview"\s*:/);
    expect(prompt).toMatch(/"evidence"\s*:\s*\[/);
    expect(prompt).toMatch(/"qaList"\s*:\s*\[/);
  });

  test("explicitly forbids generic meeting fields and legacy interview fields", () => {
    const prompt = buildLpPrompt("transcript", validLps);
    expect(prompt).not.toMatch(/"candidateInfo"\s*:/);
    expect(prompt).not.toMatch(/"recommendation"\s*:/);
    expect(prompt).not.toMatch(/"redFlags"\s*:/);
    expect(prompt).not.toMatch(/"highlights"\s*:/);
    expect(prompt).not.toMatch(/"lowlights"\s*:/);
    expect(prompt).not.toMatch(/"actions"\s*:/);
    expect(prompt).not.toMatch(/"decisions"\s*:/);
    expect(prompt).not.toMatch(/"participants"\s*:/);
    expect(prompt).not.toMatch(/"speakerKeypoints"\s*:/);
    expect(prompt).not.toContain("lpAssessment");
    expect(prompt).not.toContain("strengths");
    expect(prompt).not.toContain("improvements");
  });

  test("instructs the model to produce exactly 2 lpBlocks", () => {
    const prompt = buildLpPrompt("transcript", validLps);
    expect(prompt).toMatch(/恰好\s*为?\s*2|exactly 2/);
  });

  test("instructs the model to merge follow-up questions into single qa entries", () => {
    const prompt = buildLpPrompt("transcript", validLps);
    expect(prompt).toMatch(/追问|follow.?up/i);
    expect(prompt).toMatch(/合并|merge/i);
  });

  test("throws when fewer than 2 LPs provided", () => {
    expect(() => buildLpPrompt("t", ["Ownership"])).toThrow(/exactly 2|长度/);
    expect(() => buildLpPrompt("t", [])).toThrow();
  });

  test("throws when more than 2 LPs provided", () => {
    expect(() => buildLpPrompt("t", ["Ownership", "Dive Deep", "Think Big"])).toThrow(/exactly 2|长度/);
  });

  test("throws when an LP is not on the whitelist", () => {
    expect(() => buildLpPrompt("t", ["Ownership", "Frugality"])).toThrow(/whitelist|允许/);
  });
});
