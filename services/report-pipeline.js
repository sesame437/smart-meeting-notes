"use strict";

const { invokeModel } = require("./bedrock");
const { extractJsonFromLLMResponse } = require("./report-builder");
const { normalizeAnonymousSpeakerReport, applyNamesToReport, applyGlossaryToReport } = require("./speaker-resolution");
const { generateReportChunked, fixProjectReviewOwners } = require("./report-chunked");
const { filterGlossaryByMeetingType } = require("./glossary-filter");
const logger = require("./logger");

const MAX_RETRIES = 3;

async function invokeWithRetry(transcriptText, meetingType, filteredGlossary, extraOpts, speakerMap) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const responseText = await invokeModel(transcriptText, meetingType, filteredGlossary, undefined, speakerMap, undefined, extraOpts);
      return extractJsonFromLLMResponse(responseText);
    } catch (err) {
      lastError = err;
      const errorName = err.name || "";
      const errorCode = err.Code || err.$metadata?.httpStatusCode || 0;
      const errorMessage = err.message || "";

      const isRetryable =
        errorName.includes("ThrottlingException") ||
        errorName.includes("ServiceUnavailableException") ||
        errorName === "AbortError" ||
        errorName === "TimeoutError" ||
        errorCode === 429 ||
        errorCode === 503 ||
        errorMessage.includes("Failed to parse Bedrock JSON response");

      if (!isRetryable || attempt === MAX_RETRIES) {
        throw err;
      }

      const delay = errorMessage.includes("Failed to parse Bedrock JSON response")
        ? 5000
        : Math.min(5000 * Math.pow(3, attempt - 1), 300000);
      logger.warn("report-pipeline", "bedrock-retry", {
        attempt,
        nextAttempt: attempt + 1,
        delayMs: delay,
        errorName,
      });
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

/**
 * Unified report generation pipeline.
 *
 * @param {string} transcriptText - Formatted transcript (caller handles reading/pruning)
 * @param {string} meetingType - general/weekly/tech/customer/interview/merged
 * @param {Object} options
 * @param {Object|null} options.speakerMap - { SPEAKER_X: "RealName" }
 * @param {Object} options.speakerAliases - { SPEAKER_X: ["alias1"] }
 * @param {Array} options.existingRoster - Previous speakerRoster entries
 * @param {Array} options.glossaryItems - Full (unfiltered) glossary items
 * @param {Object|null} options.extraOpts - { interviewSubType, interviewLPs }
 * @param {boolean} options.applyNames - Run full speaker name injection
 * @param {boolean} options.retry - Wrap Bedrock call in retry logic
 * @returns {Promise<Object>} Generated report
 */
async function generateReport(transcriptText, meetingType, {
  speakerMap = null,
  speakerAliases = {},
  existingRoster = [],
  glossaryItems = [],
  extraOpts = null,
  applyNames = false,
  retry = true,
} = {}) {
  const filteredGlossary = filterGlossaryByMeetingType(glossaryItems, meetingType);

  let report;
  if (meetingType === "weekly") {
    report = await generateReportChunked(transcriptText, meetingType, filteredGlossary, speakerMap);
  } else if (retry) {
    report = await invokeWithRetry(transcriptText, meetingType, filteredGlossary, extraOpts, speakerMap);
  } else {
    const responseText = await invokeModel(transcriptText, meetingType, filteredGlossary, undefined, speakerMap, undefined, extraOpts);
    report = extractJsonFromLLMResponse(responseText);
  }

  const hasSpeakerMap = speakerMap && Object.keys(speakerMap).length > 0;

  if (!hasSpeakerMap) {
    report = normalizeAnonymousSpeakerReport(report);
    if (glossaryItems.length > 0) {
      report = applyGlossaryToReport(report, glossaryItems);
    }
  } else if (applyNames) {
    const nameMap = {};
    Object.entries(speakerMap).forEach(([k, v]) => {
      if (v && v.trim()) nameMap[k] = v.trim();
    });
    const result = applyNamesToReport(report, nameMap, speakerAliases, existingRoster, glossaryItems);
    report = result.report;
  } else {
    report = applyGlossaryToReport(report, glossaryItems);
  }

  // Always fix owners for weekly meetings (doesn't depend on speakerMap)
  if (meetingType === "weekly" && report.projectReviews) {
    report.projectReviews = fixProjectReviewOwners(report.projectReviews, {
      speakerKeypoints: report.speakerKeypoints || {},
      speakerMap: speakerMap || {},
      glossaryItems,
    });
  }

  return report;
}

module.exports = { generateReport };
