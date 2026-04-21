"use strict";

const { buildStructuredGlossaryNote } = require("../services/glossary-prompt-builder");

describe("buildStructuredGlossaryNote", () => {
  test("empty or non-array input returns empty string", () => {
    expect(buildStructuredGlossaryNote([])).toBe("");
    expect(buildStructuredGlossaryNote(null)).toBe("");
    expect(buildStructuredGlossaryNote(undefined)).toBe("");
  });

  test("legacy string[] input falls back to flat note (backward compat)", () => {
    const out = buildStructuredGlossaryNote(["术语A", "术语B"]);
    expect(out).toContain("专有名词词库");
    expect(out).toContain("术语A");
    expect(out).toContain("术语B");
    expect(out).toContain("术语A、术语B");
  });

  test("single category items render under one section", () => {
    const items = [
      { term: "Landing Zone", category: "术语" },
      { term: "VOC Agent",    category: "术语" },
    ];
    const out = buildStructuredGlossaryNote(items);
    expect(out).toContain("# 专有名词词库");
    expect(out).toContain("## 术语");
    expect(out).toContain("- Landing Zone");
    expect(out).toContain("- VOC Agent");
    expect(out).not.toContain("## 人员");
    expect(out).not.toContain("## 组织");
  });

  test("multi-category items render in canonical order 人员→组织→术语", () => {
    const items = [
      { term: "Landing Zone", category: "术语" },
      { term: "罗氏",          category: "组织" },
      { term: "黄超",          category: "人员" },
    ];
    const out = buildStructuredGlossaryNote(items);
    const idxPerson = out.indexOf("## 人员");
    const idxOrg    = out.indexOf("## 组织");
    const idxTerm   = out.indexOf("## 术语");
    expect(idxPerson).toBeGreaterThan(-1);
    expect(idxOrg).toBeGreaterThan(idxPerson);
    expect(idxTerm).toBeGreaterThan(idxOrg);
  });

  test("includes definition when present (truncated at 30 chars)", () => {
    const items = [
      { term: "黄超", category: "人员", definition: "医疗 HCLS 架构师" },
      { term: "超长", category: "人员", definition: "a".repeat(60) },
    ];
    const out = buildStructuredGlossaryNote(items);
    expect(out).toContain("- 黄超（医疗 HCLS 架构师）");
    expect(out).toMatch(/- 超长（a{30}…）/);
  });

  test("splits aliases by , or ，", () => {
    const items = [
      { term: "罗氏", category: "组织", aliases: "Roche,罗氏制药" },
      { term: "AWS", category: "组织", aliases: "亚马逊云科技，AWS China" },
    ];
    const out = buildStructuredGlossaryNote(items);
    expect(out).toContain("| 别名：Roche, 罗氏制药");
    expect(out).toContain("| 别名：亚马逊云科技, AWS China");
  });

  test("array-form aliases also works", () => {
    const items = [{ term: "QuickSight", category: "术语", aliases: ["QS", "Quick Sight"] }];
    const out = buildStructuredGlossaryNote(items);
    expect(out).toContain("- QuickSight | 别名：QS, Quick Sight");
  });

  test("items without definition or aliases render just the term", () => {
    const items = [{ term: "Walltech", category: "组织" }];
    const out = buildStructuredGlossaryNote(items);
    expect(out).toContain("- Walltech\n");
    // The Walltech line itself has no parens or alias marker (header may have them)
    expect(out).not.toContain("Walltech（");
    expect(out).not.toContain("Walltech |");
  });

  test("uncategorized items (no category) rendered under final 其他 section", () => {
    const items = [
      { term: "黄超", category: "人员" },
      { term: "刘小亮", definition: "AWS 客户经理" },
    ];
    const out = buildStructuredGlossaryNote(items);
    expect(out).toContain("## 其他");
    expect(out).toContain("- 刘小亮（AWS 客户经理）");
  });

  test("trailing newline for clean prompt concatenation", () => {
    const items = [{ term: "X", category: "术语" }];
    const out = buildStructuredGlossaryNote(items);
    expect(out.endsWith("\n\n")).toBe(true);
  });

  test("skips null/undefined/malformed items without throwing", () => {
    const items = [
      null,
      undefined,
      {},
      { category: "术语" },                      // no term
      { term: "",    category: "术语" },          // empty term
      { term: "  ",  category: "术语" },          // whitespace-only term
      { term: "Real", category: "术语" },
    ];
    // Should not throw
    const out = buildStructuredGlossaryNote(items);
    expect(out).toContain("- Real");
    // None of the malformed entries appear in output
    expect(out).not.toMatch(/- \s*\n/);
    expect(out).not.toMatch(/- \(/);
  });

  test("empty result when all items are malformed", () => {
    const items = [null, {}, { category: "术语" }];
    const out = buildStructuredGlossaryNote(items);
    expect(out).toBe("");
  });
});
