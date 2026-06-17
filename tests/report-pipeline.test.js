"use strict";

jest.mock("../services/bedrock", () => ({
  invokeModel: jest.fn(),
}));
jest.mock("../services/report-builder", () => ({
  extractJsonFromLLMResponse: jest.fn(),
}));
jest.mock("../services/report-speaker-normalizer", () => ({
  normalizeAnonymousSpeakerReport: jest.fn((r) => ({ ...r, _normalized: true })),
}));
jest.mock("../services/report-post-processor", () => ({
  applyNamesToReport: jest.fn((report, _nameMap) => ({ report: { ...report, _namesApplied: true }, appliedAliases: [] })),
  applyGlossaryToReport: jest.fn((report) => ({ ...report, _glossaryApplied: true })),
}));
jest.mock("../services/report-chunked", () => ({
  generateReportChunked: jest.fn(),
  fixProjectReviewOwners: jest.fn((prs) => prs.map((pr) => ({ ...pr, _ownerFixed: true }))),
}));
jest.mock("../services/glossary-filter", () => ({
  filterGlossaryByMeetingType: jest.fn((items) => items),
}));
jest.mock("../services/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const { generateReport } = require("../services/report-pipeline");
const { invokeModel } = require("../services/bedrock");
const { extractJsonFromLLMResponse } = require("../services/report-builder");
const { normalizeAnonymousSpeakerReport } = require("../services/report-speaker-normalizer");
const { applyNamesToReport, applyGlossaryToReport } = require("../services/report-post-processor");
const { generateReportChunked, fixProjectReviewOwners } = require("../services/report-chunked");
const { filterGlossaryByMeetingType } = require("../services/glossary-filter");

const FAKE_REPORT = { summary: "test", participants: ["A"], actions: [] };

beforeEach(() => {
  jest.clearAllMocks();
  invokeModel.mockResolvedValue('{"summary":"test"}');
  extractJsonFromLLMResponse.mockReturnValue(FAKE_REPORT);
  generateReportChunked.mockResolvedValue(FAKE_REPORT);
});

describe("generateReport", () => {
  describe("meeting type branching", () => {
    it("uses generateReportChunked for weekly meetings", async () => {
      await generateReport("transcript", "weekly", { glossaryItems: [{ term: "x" }] });
      expect(generateReportChunked).toHaveBeenCalledWith("transcript", "weekly", [{ term: "x" }], null);
      expect(invokeModel).not.toHaveBeenCalled();
    });

    it("uses invokeModel for non-weekly meetings", async () => {
      await generateReport("transcript", "general", { glossaryItems: [] });
      expect(invokeModel).toHaveBeenCalled();
      expect(generateReportChunked).not.toHaveBeenCalled();
    });
  });

  describe("retry behavior", () => {
    beforeEach(() => { jest.useFakeTimers(); });
    afterEach(() => { jest.useRealTimers(); });

    it("retries on throttling when retry=true", async () => {
      const throttleErr = new Error("throttled");
      throttleErr.name = "ThrottlingException";
      invokeModel
        .mockRejectedValueOnce(throttleErr)
        .mockResolvedValueOnce('{"summary":"ok"}');
      extractJsonFromLLMResponse.mockReturnValue({ summary: "ok" });

      const promise = generateReport("t", "general", { retry: true });
      await jest.advanceTimersByTimeAsync(5000);
      const result = await promise;
      expect(invokeModel).toHaveBeenCalledTimes(2);
      expect(result).toBeDefined();
    });

    it("throws immediately when retry=false", async () => {
      const err = new Error("throttled");
      err.name = "ThrottlingException";
      invokeModel.mockRejectedValue(err);

      await expect(generateReport("t", "general", { retry: false })).rejects.toThrow("throttled");
      expect(invokeModel).toHaveBeenCalledTimes(1);
    });
  });

  describe("post-processing without speakerMap", () => {
    it("normalizes anonymous speakers", async () => {
      const result = await generateReport("t", "general", {});
      expect(normalizeAnonymousSpeakerReport).toHaveBeenCalledWith(FAKE_REPORT);
      expect(result._normalized).toBe(true);
    });

    it("applies glossary when glossaryItems provided", async () => {
      const items = [{ term: "AWS", aliases: ["亚马逊"] }];
      await generateReport("t", "general", { glossaryItems: items });
      expect(applyGlossaryToReport).toHaveBeenCalled();
    });
  });

  describe("post-processing with speakerMap + applyNames=false", () => {
    it("applies only glossary (lightweight post-process)", async () => {
      const items = [{ term: "x" }];
      const result = await generateReport("t", "general", {
        speakerMap: { SPEAKER_0: "Alice" },
        glossaryItems: items,
        applyNames: false,
      });
      expect(normalizeAnonymousSpeakerReport).not.toHaveBeenCalled();
      expect(applyNamesToReport).not.toHaveBeenCalled();
      expect(applyGlossaryToReport).toHaveBeenCalledWith(FAKE_REPORT, items);
      expect(result._glossaryApplied).toBe(true);
    });
  });

  describe("post-processing with speakerMap + applyNames=true", () => {
    it("runs full applyNamesToReport", async () => {
      const result = await generateReport("t", "general", {
        speakerMap: { SPEAKER_0: "Alice" },
        speakerAliases: { SPEAKER_0: ["小A"] },
        existingRoster: [{ displayLabel: "Alice" }],
        glossaryItems: [{ term: "x" }],
        applyNames: true,
      });
      expect(applyNamesToReport).toHaveBeenCalledWith(
        FAKE_REPORT,
        { SPEAKER_0: "Alice" },
        { SPEAKER_0: ["小A"] },
        [{ displayLabel: "Alice" }],
        [{ term: "x" }]
      );
      expect(result._namesApplied).toBe(true);
    });

    it("does not call fixProjectReviewOwners for non-weekly", async () => {
      await generateReport("t", "general", {
        speakerMap: { SPEAKER_0: "Alice" },
        applyNames: true,
      });
      expect(fixProjectReviewOwners).not.toHaveBeenCalled();
    });
  });

  describe("fixOwners for weekly", () => {
    it("always calls fixProjectReviewOwners for weekly meetings", async () => {
      generateReportChunked.mockResolvedValue({
        ...FAKE_REPORT,
        projectReviews: [{ project: "P1", followUps: [] }],
        speakerKeypoints: { SPEAKER_0: ["P1 progress"] },
      });
      applyNamesToReport.mockReturnValue({
        report: { ...FAKE_REPORT, projectReviews: [{ project: "P1", followUps: [] }], speakerKeypoints: { SPEAKER_0: ["P1 progress"] }, _namesApplied: true },
        appliedAliases: [],
      });

      const result = await generateReport("transcript", "weekly", {
        speakerMap: { SPEAKER_0: "Alice" },
        applyNames: true,
        glossaryItems: [{ term: "P1", owner: "Alice", aliases: "" }],
      });
      expect(fixProjectReviewOwners).toHaveBeenCalledWith(
        [{ project: "P1", followUps: [] }],
        { speakerKeypoints: { SPEAKER_0: ["P1 progress"] }, speakerMap: { SPEAKER_0: "Alice" }, glossaryItems: [{ term: "P1", owner: "Alice", aliases: "" }] }
      );
      expect(result.projectReviews[0]._ownerFixed).toBe(true);
    });
  });

  describe("glossary filtering", () => {
    it("filters glossary by meetingType before passing to Bedrock", async () => {
      const items = [{ term: "a", category: "weekly" }, { term: "b", category: "general" }];
      filterGlossaryByMeetingType.mockReturnValue([items[1]]);

      await generateReport("t", "general", { glossaryItems: items });
      expect(filterGlossaryByMeetingType).toHaveBeenCalledWith(items, "general");
      expect(invokeModel).toHaveBeenCalledWith("t", "general", [items[1]], undefined, null, undefined, null);
    });
  });

  describe("extraOpts passthrough", () => {
    it("passes extraOpts to invokeModel for interview type", async () => {
      const extra = { interviewSubType: "lp", interviewLPs: ["Ownership", "Dive Deep"] };
      await generateReport("t", "interview", { extraOpts: extra, retry: false });
      expect(invokeModel).toHaveBeenCalledWith(
        "t", "interview", expect.any(Array), undefined, null, undefined, extra
      );
    });
  });
});
