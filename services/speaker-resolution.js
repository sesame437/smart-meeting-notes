"use strict";

const { pruneNoiseSpeakers, DEFAULT_MIN_CHARS, DEFAULT_MIN_SHARE_RATIO, DEFAULT_KEEP_FLOOR } = require("./speaker-pruner");
const { normalizeAnonymousSpeakerReport, buildAnonymousSpeakerRoster } = require("./report-speaker-normalizer");
const { applyNamesToReport, applyGlossaryToReport } = require("./report-post-processor");
const {
  collectSpeakerAliasMap,
  buildSpeakerRoster,
  replaceNameAlias,
  normalizeDuplicateNames,
  applyGlossaryAliases,
  isIgnorableAliasFragment,
  resolveRosterSpeakerKey,
  inferGlossaryCategory,
} = require("./speaker-roster");

module.exports = {
  pruneNoiseSpeakers,
  DEFAULT_MIN_CHARS,
  DEFAULT_MIN_SHARE_RATIO,
  DEFAULT_KEEP_FLOOR,
  normalizeAnonymousSpeakerReport,
  buildAnonymousSpeakerRoster,
  applyNamesToReport,
  applyGlossaryToReport,
  collectSpeakerAliasMap,
  buildSpeakerRoster,
  replaceNameAlias,
  normalizeDuplicateNames,
  applyGlossaryAliases,
  isIgnorableAliasFragment,
  resolveRosterSpeakerKey,
  inferGlossaryCategory,
};
