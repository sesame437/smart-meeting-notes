"use strict";

const TRUNCATE_MARKER = "\n\n[...transcript truncated...]\n\n";

/**
 * Sliding-window truncation for live transcripts that exceed the LLM input budget.
 * Keeps the earliest 20 % (meeting background) and the most recent 70 % (current context),
 * dropping the middle. Returns the original text if it is at or under the limit.
 *
 * @param {string} transcript
 * @param {number} charLimit
 * @returns {string}
 */
function truncateTranscriptForLive(transcript, charLimit) {
  if (!transcript || transcript.length <= charLimit) return transcript;
  const headLen = Math.floor(charLimit * 0.2);
  const tailLen = Math.floor(charLimit * 0.7);
  const head = transcript.slice(0, headLen);
  const tail = transcript.slice(-tailLen);
  return head + TRUNCATE_MARKER + tail;
}

module.exports = { truncateTranscriptForLive };
