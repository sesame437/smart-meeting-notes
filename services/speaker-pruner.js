"use strict";

const DEFAULT_MIN_CHARS = 100;
const DEFAULT_MIN_SHARE_RATIO = 0.01;
const DEFAULT_KEEP_FLOOR = 300;

function pruneNoiseSpeakers(segments, options = {}) {
  if (!Array.isArray(segments) || segments.length === 0) {
    return { segments: [], prunedSpeakers: [] };
  }

  if (process.env.SPEAKER_PRUNE_ENABLED === "false") {
    return { segments, prunedSpeakers: [] };
  }

  const minChars = options.minChars ?? DEFAULT_MIN_CHARS;
  const minShareRatio = options.minShareRatio ?? DEFAULT_MIN_SHARE_RATIO;
  const keepFloor = options.keepFloor ?? DEFAULT_KEEP_FLOOR;

  const stats = new Map();
  let totalChars = 0;
  for (const s of segments) {
    const key = s.speaker;
    const chars = (s.text || "").length;
    totalChars += chars;
    const cur = stats.get(key) || { chars: 0, segs: 0 };
    cur.chars += chars;
    cur.segs += 1;
    stats.set(key, cur);
  }

  // Never prune if only one speaker
  if (stats.size <= 1) {
    return { segments, prunedSpeakers: [] };
  }

  const prunedIds = new Set();
  const prunedSpeakers = [];
  for (const [speaker, { chars, segs }] of stats.entries()) {
    const share = totalChars > 0 ? chars / totalChars : 0;
    const triggeredByNoise = chars < minChars || share < minShareRatio;
    const belowKeepFloor = chars < keepFloor;
    if (triggeredByNoise && belowKeepFloor) {
      prunedIds.add(speaker);
      prunedSpeakers.push({ speaker, chars, segs, share });
    }
  }

  if (prunedIds.size === 0) {
    return { segments, prunedSpeakers: [] };
  }

  const filtered = segments.filter((s) => !prunedIds.has(s.speaker));
  return { segments: filtered, prunedSpeakers };
}

module.exports = {
  pruneNoiseSpeakers,
  DEFAULT_MIN_CHARS,
  DEFAULT_MIN_SHARE_RATIO,
  DEFAULT_KEEP_FLOOR,
};
