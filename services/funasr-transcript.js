"use strict";

/**
 * Build plain text transcript from funasr.json output.
 *
 * Format: one line per segment, "[speaker_label] text", original order.
 * Faithful output: no truncation, no merge of consecutive same-speaker segments,
 * no filtering of empty-text segments, no punctuation normalization.
 *
 * @param {object} funasrJson - parsed funasr.json
 * @param {object} [speakerMap={}] - { rawLabel: realName } mapping
 * @returns {string}
 */
function buildPlainTranscript(funasrJson, speakerMap = {}) {
  if (!funasrJson || typeof funasrJson !== "object") return "";

  const segments = Array.isArray(funasrJson.segments) ? funasrJson.segments : null;

  if (!segments || segments.length === 0) {
    if (typeof funasrJson.text === "string" && funasrJson.text.length > 0) {
      const label = speakerMap.SPEAKER_0 || "SPEAKER_0";
      return `[${label}] ${funasrJson.text}`;
    }
    return "";
  }

  const lines = segments.map((seg) => {
    const rawLabel =
      typeof seg.speaker === "number"
        ? `SPEAKER_${seg.speaker}`
        : seg.speaker || "SPEAKER_0";
    const label = speakerMap[rawLabel] || rawLabel;
    const text = typeof seg.text === "string" ? seg.text : "";
    return `[${label}] ${text}`;
  });

  return lines.join("\n");
}

module.exports = { buildPlainTranscript };
