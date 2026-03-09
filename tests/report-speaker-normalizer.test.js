"use strict";

const { normalizeAnonymousSpeakerReport, buildAnonymousSpeakerRoster } = require("../services/report-speaker-normalizer");

describe("normalizeAnonymousSpeakerReport", () => {
  test("normalizes anonymous speaker labels to 参会人 N across report", () => {
    const report = {
      summary: "主持人安排成员A跟进客户。",
      participants: [
        "主持人（SPEAKER_0，团队负责人）",
        "成员A（SPEAKER_1，孔帅/瑞远，医疗方向SA）",
      ],
      actions: [
        { task: "跟进客户", owner: "成员A（孔帅）", deadline: "", priority: "high" },
      ],
      speakerKeypoints: {
        SPEAKER_0: ["主持开场并安排任务"],
        SPEAKER_1: ["汇报客户进展"],
      },
    };

    const normalized = normalizeAnonymousSpeakerReport(report);

    expect(normalized.participants).toEqual(["参会人 1", "参会人 2"]);
    expect(normalized.summary).toContain("参会人 1");
    expect(normalized.summary).toContain("参会人 2");
    expect(normalized.actions[0].owner).toBe("参会人 2");
    expect(normalized.speakerKeypoints).toEqual(report.speakerKeypoints);
    expect(normalized.speakerRoster).toEqual([
      expect.objectContaining({
        speakerKey: "SPEAKER_0",
        displayLabel: "参会人 1",
      }),
      expect.objectContaining({
        speakerKey: "SPEAKER_1",
        displayLabel: "参会人 2",
      }),
    ]);
  });
});

describe("extractPossibleName via buildAnonymousSpeakerRoster", () => {
  function extractName(participantStr, speakerKey = "SPEAKER_0") {
    const report = {
      participants: [participantStr],
      speakerKeypoints: { [speakerKey]: [] },
    };
    const roster = buildAnonymousSpeakerRoster(report);
    return roster[0] ? roster[0].possibleName : "";
  }

  test("extracts name-like part from mixed labels", () => {
    const name = extractName("成员A（SPEAKER_0，孔帅/瑞远，医疗方向SA）");
    expect(name).toBe("孔帅");
  });

  test("filters generic role terms", () => {
    const name = extractName("主持人（SPEAKER_0）");
    expect(name).toBe("主持人");
  });

  test("returns cleaned string when no name-like part found", () => {
    const name = extractName("参会人 1（SPEAKER_0）");
    expect(name).toBeTruthy();
  });
});
