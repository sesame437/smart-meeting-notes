"use strict";

const {
  filterGlossaryByMeetingType,
  MEETING_TYPE_CATEGORIES,
} = require("../services/glossary-filter");

const SAMPLE = [
  { term: "黄超",     category: "人员", definition: "HCLS SA" },
  { term: "罗氏",     category: "组织", aliases: "Roche,罗氏制药" },
  { term: "Landing Zone", category: "术语" },
  { term: "刘小亮",   /* no category */ definition: "AWS 客户经理" },
];

describe("MEETING_TYPE_CATEGORIES matrix", () => {
  test("weekly/general/merged include all 3 categories", () => {
    expect(MEETING_TYPE_CATEGORIES.weekly).toEqual(["人员", "术语", "组织"]);
    expect(MEETING_TYPE_CATEGORIES.general).toEqual(["人员", "术语", "组织"]);
    expect(MEETING_TYPE_CATEGORIES.merged).toEqual(["人员", "术语", "组织"]);
  });
  test("customer/tech exclude 组织", () => {
    expect(MEETING_TYPE_CATEGORIES.customer).toEqual(["人员", "术语"]);
    expect(MEETING_TYPE_CATEGORIES.tech).toEqual(["人员", "术语"]);
  });
  test("interview only has 术语", () => {
    expect(MEETING_TYPE_CATEGORIES.interview).toEqual(["术语"]);
  });
});

describe("filterGlossaryByMeetingType", () => {
  test("empty input returns empty array", () => {
    expect(filterGlossaryByMeetingType([], "weekly")).toEqual([]);
    expect(filterGlossaryByMeetingType(null, "weekly")).toEqual([]);
    expect(filterGlossaryByMeetingType(undefined, "weekly")).toEqual([]);
  });

  test("weekly returns all 3 categories plus untagged items", () => {
    const out = filterGlossaryByMeetingType(SAMPLE, "weekly");
    expect(out.map((i) => i.term).sort()).toEqual(["Landing Zone", "刘小亮", "罗氏", "黄超"]);
  });

  test("interview returns only 术语 plus untagged items", () => {
    const out = filterGlossaryByMeetingType(SAMPLE, "interview");
    expect(out.map((i) => i.term).sort()).toEqual(["Landing Zone", "刘小亮"]);
  });

  test("customer excludes 组织 but keeps untagged", () => {
    const out = filterGlossaryByMeetingType(SAMPLE, "customer");
    expect(out.map((i) => i.term).sort()).toEqual(["Landing Zone", "刘小亮", "黄超"]);
  });

  test("tech excludes 组织", () => {
    const out = filterGlossaryByMeetingType(SAMPLE, "tech");
    expect(out.map((i) => i.term).some((t) => t === "罗氏")).toBe(false);
  });

  test("unknown meetingType falls back to all categories", () => {
    const out = filterGlossaryByMeetingType(SAMPLE, "unknown-type");
    expect(out).toHaveLength(4);
  });

  test("items with empty category string are treated as untagged", () => {
    const items = [
      { term: "A", category: "" },
      { term: "B", category: "术语" },
    ];
    const out = filterGlossaryByMeetingType(items, "interview");
    expect(out.map((i) => i.term).sort()).toEqual(["A", "B"]);
  });

  test("preserves original item structure (term/aliases/definition/category)", () => {
    const out = filterGlossaryByMeetingType(SAMPLE, "weekly");
    const luoshi = out.find((i) => i.term === "罗氏");
    expect(luoshi).toEqual({ term: "罗氏", category: "组织", aliases: "Roche,罗氏制药" });
  });
});
