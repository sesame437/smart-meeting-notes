"use strict";

const {
  collectSpeakerAliasMap,
  buildSpeakerRoster,
  replaceNameAlias,
  normalizeDuplicateNames,
  applyGlossaryAliases,
} = require("./speaker-roster");

/**
 * Apply speaker name replacements, build roster, and apply glossary aliases.
 * Shared by: regenerate route, apply-speaker-names route.
 *
 * @param {Object} report - Raw Bedrock report JSON
 * @param {Object} nameMap - { SPEAKER_X: "realName" }
 * @param {Object} [speakerAliases] - { SPEAKER_X: ["alias1", "alias2"] }
 * @param {Array}  [existingRoster] - Previous speakerRoster entries
 * @param {Array}  [glossaryItems] - Full glossary items from glossaryStore
 * @returns {{ report: Object, appliedAliases: Array }}
 */
function applyNamesToReport(report, nameMap, speakerAliases = {}, existingRoster = [], glossaryItems = []) {
  const participantAliasMap = collectSpeakerAliasMap(
    report.participants, nameMap, speakerAliases, existingRoster
  );
  const speakerRoster = buildSpeakerRoster(
    report, nameMap, speakerAliases, existingRoster
  );

  let reportStr = JSON.stringify(report);
  const replacements = { ...participantAliasMap, ...nameMap };
  Object.entries(replacements)
    .sort((a, b) => b[0].length - a[0].length)
    .forEach(([alias, name]) => {
      reportStr = replaceNameAlias(reportStr, alias, name);
    });

  let appliedAliases = [];
  if (glossaryItems.length > 0) {
    const result = applyGlossaryAliases(reportStr, glossaryItems);
    reportStr = result.reportStr;
    appliedAliases = result.appliedAliases;
  }

  const updated = normalizeDuplicateNames(JSON.parse(reportStr), Object.values(nameMap));
  updated.speakerKeypoints = report.speakerKeypoints || {};
  updated.speakerRoster = speakerRoster;
  updated.participants = [
    ...new Set(speakerRoster.map((e) => e.resolvedName || e.displayLabel)),
  ];

  if (Array.isArray(updated.awsAttendees)) {
    updated.awsAttendees = [...new Set(updated.awsAttendees)];
  }
  if (updated.customerInfo && Array.isArray(updated.customerInfo.attendees)) {
    updated.customerInfo.attendees = [...new Set(updated.customerInfo.attendees)];
  }

  return { report: updated, appliedAliases };
}

/**
 * Lightweight glossary-only post-processing (no speaker names).
 * Used by report-worker for initial generation (no speakerMap yet).
 */
function applyGlossaryToReport(report, glossaryItems) {
  if (!glossaryItems || glossaryItems.length === 0) return report;
  let reportStr = JSON.stringify(report);
  const { reportStr: processed } = applyGlossaryAliases(reportStr, glossaryItems);
  return JSON.parse(processed);
}

module.exports = { applyNamesToReport, applyGlossaryToReport };
