"use strict";

const { buildPhonescreenPrompt, buildLpPrompt } = require("../services/bedrock-interview");

describe("buildPhonescreenPrompt", () => {
  test("includes transcript text in prompt", () => {
    const prompt = buildPhonescreenPrompt("[00:00:05] Hello, can you describe your project?");
    expect(prompt).toContain("[00:00:05]");
  });

  test("requests phonescreen JSON shape: summary, candidateInfo, qaList, redFlags, recommendation", () => {
    const prompt = buildPhonescreenPrompt("transcript");
    expect(prompt).toMatch(/"interviewSubType"\s*:\s*"phonescreen"/);
    expect(prompt).toContain("qaList");
    expect(prompt).toContain("redFlags");
    expect(prompt).toContain("recommendation");
    expect(prompt).toContain("candidateInfo");
    expect(prompt).not.toContain("lpBlocks");
    expect(prompt).not.toContain("lpAssessment");
    expect(prompt).not.toContain("strengths");
    expect(prompt).not.toContain("improvements");
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

  test("requests lp JSON shape: lpBlocks with exactly 2 entries keyed to user LPs", () => {
    const prompt = buildLpPrompt("transcript", validLps);
    expect(prompt).toMatch(/"interviewSubType"\s*:\s*"lp"/);
    expect(prompt).toMatch(/"lpBlocks"\s*:\s*\[/);
    expect(prompt).toContain('"qaList"');  // qaList IS present — nested inside lpBlocks, that's correct
    expect(prompt).toContain("redFlags");
    expect(prompt).toContain("recommendation");
    expect(prompt).not.toContain("lpAssessment");
  });

  test("instructs the model to produce exactly 2 lpBlocks matching the provided LP names", () => {
    const prompt = buildLpPrompt("transcript", validLps);
    expect(prompt).toMatch(/exactly 2|恰好 2|必须 2/);
  });

  test("throws when fewer than 2 LPs provided", () => {
    expect(() => buildLpPrompt("t", ["Ownership"])).toThrow(/exactly 2|长度/);
    expect(() => buildLpPrompt("t", [])).toThrow();
  });

  test("throws when more than 2 LPs provided", () => {
    expect(() => buildLpPrompt("t", ["Ownership", "Dive Deep", "Think Big"])).toThrow(/exactly 2|长度/);
  });

  test("throws when an LP is not on the whitelist", () => {
    expect(() => buildLpPrompt("t", ["Ownership", "Bias for Action"])).toThrow(/whitelist|允许/);
  });
});
