"use strict";

const { applyNamesToReport, applyGlossaryToReport } = require("../services/report-post-processor");

describe("applyNamesToReport", () => {
  const baseReport = {
    summary: "SPEAKER_0 discussed the project with SPEAKER_1",
    participants: ["主持人（SPEAKER_0）", "成员A（SPEAKER_1）"],
    highlights: [{ point: "SPEAKER_0 提出方案", detail: "详情" }],
    lowlights: [],
    actions: [{ task: "跟进", owner: "SPEAKER_1", deadline: "下周" }],
    decisions: [],
    speakerKeypoints: {
      SPEAKER_0: ["要点一内容较长的描述文字", "要点二内容较长的描述文字"],
      SPEAKER_1: ["要点三内容较长的描述文字"],
    },
  };

  test("replaces speaker labels with real names and builds roster", () => {
    const nameMap = { SPEAKER_0: "Alice", SPEAKER_1: "Bob" };
    const { report } = applyNamesToReport(baseReport, nameMap);
    expect(report.participants).toContain("Alice");
    expect(report.participants).toContain("Bob");
    expect(report.participants).not.toContain("SPEAKER_0");
    expect(report.summary).toContain("Alice");
    expect(report.summary).toContain("Bob");
    expect(report.speakerRoster).toBeDefined();
    expect(report.speakerRoster.length).toBe(2);
    expect(report.speakerRoster[0].resolvedName).toBe("Alice");
  });

  test("preserves speakerKeypoints from original report", () => {
    const nameMap = { SPEAKER_0: "Alice", SPEAKER_1: "Bob" };
    const { report } = applyNamesToReport(baseReport, nameMap);
    expect(report.speakerKeypoints).toEqual(baseReport.speakerKeypoints);
    expect(report.speakerKeypoints.SPEAKER_0).toHaveLength(2);
  });

  test("transfers keypoints to speakerRoster entries", () => {
    const nameMap = { SPEAKER_0: "Alice", SPEAKER_1: "Bob" };
    const { report } = applyNamesToReport(baseReport, nameMap);
    const alice = report.speakerRoster.find((e) => e.resolvedName === "Alice");
    expect(alice).toBeDefined();
    expect(alice.keypoints.length).toBeGreaterThan(0);
  });

  test("applies glossary aliases when provided", () => {
    const nameMap = { SPEAKER_0: "Alice" };
    const reportWithAlias = {
      ...baseReport,
      summary: "QS is great and SPEAKER_0 likes it",
    };
    const glossaryItems = [
      { termId: "t1", term: "QuickSight", aliases: "QS" },
    ];
    const { report, appliedAliases } = applyNamesToReport(
      reportWithAlias, nameMap, {}, [], glossaryItems
    );
    expect(report.summary).toContain("QuickSight");
    expect(appliedAliases.length).toBeGreaterThan(0);
  });

  test("deduplicates participants", () => {
    const nameMap = { SPEAKER_0: "Alice", SPEAKER_1: "Alice" };
    const { report } = applyNamesToReport(baseReport, nameMap);
    const aliceCount = report.participants.filter((p) => p === "Alice").length;
    expect(aliceCount).toBe(1);
  });

  test("deduplicates awsAttendees when present", () => {
    const reportWithAws = {
      ...baseReport,
      awsAttendees: ["Alice", "Alice", "Bob"],
    };
    const nameMap = { SPEAKER_0: "Alice" };
    const { report } = applyNamesToReport(reportWithAws, nameMap);
    expect(report.awsAttendees).toEqual(["Alice", "Bob"]);
  });
  test("handles speakerKeypoints keyed by real names (LLM with speakerMap)", () => {
    const realNameReport = {
      summary: "Alice discussed the project",
      participants: ["Alice", "Bob"],
      highlights: [],
      lowlights: [],
      actions: [],
      decisions: [],
      speakerKeypoints: {
        Alice: ["Alice detailed keypoint about architecture design and implementation"],
        Bob: ["Bob detailed keypoint about testing strategy and quality"],
      },
    };
    const nameMap = { SPEAKER_0: "Alice", SPEAKER_1: "Bob" };
    const { report } = applyNamesToReport(realNameReport, nameMap);
    expect(report.speakerRoster.length).toBe(2);
    const alice = report.speakerRoster.find((e) => e.resolvedName === "Alice");
    expect(alice).toBeDefined();
    expect(alice.keypoints.length).toBeGreaterThan(0);
    expect(alice.keypoints[0]).toContain("architecture");
    const bob = report.speakerRoster.find((e) => e.resolvedName === "Bob");
    expect(bob).toBeDefined();
    expect(bob.keypoints.length).toBeGreaterThan(0);
  });
});

describe("applyGlossaryToReport", () => {
  test("replaces glossary aliases in report text", () => {
    const report = {
      summary: "We discussed QS deployment",
      highlights: [{ point: "QS is ready", detail: "detail" }],
    };
    const glossaryItems = [
      { termId: "t1", term: "QuickSight", aliases: "QS" },
    ];
    const result = applyGlossaryToReport(report, glossaryItems);
    expect(result.summary).toContain("QuickSight");
    expect(result.highlights[0].point).toContain("QuickSight");
  });

  test("returns report unchanged when no glossary items", () => {
    const report = { summary: "test" };
    expect(applyGlossaryToReport(report, [])).toEqual(report);
    expect(applyGlossaryToReport(report, null)).toEqual(report);
  });

  test("handles glossary items without aliases", () => {
    const report = { summary: "test" };
    const glossaryItems = [{ termId: "t1", term: "Bedrock" }];
    const result = applyGlossaryToReport(report, glossaryItems);
    expect(result.summary).toBe("test");
  });
});
