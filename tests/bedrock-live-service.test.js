"use strict";

const { truncateTranscriptForLive } = require("../services/bedrock-live");

describe("truncateTranscriptForLive", () => {
  test("passes short transcript through unchanged", () => {
    const input = "[00:00:05] hello\n[00:00:10] world\n";
    expect(truncateTranscriptForLive(input, 1000)).toBe(input);
  });

  test("truncates to head 20% + tail 70% of limit when over limit", () => {
    const input = "x".repeat(10_000);
    const limit = 1000;
    const out = truncateTranscriptForLive(input, limit);
    expect(out).toContain("[...transcript truncated...]");
    expect(out.length).toBeLessThanOrEqual(limit + "[...transcript truncated...]".length + 10);
    // Roughly head 200 + tail 700 = 900 chars of real content
    expect(out.startsWith("x".repeat(200))).toBe(true);
    expect(out.endsWith("x".repeat(700))).toBe(true);
  });

  test("keeps middle content verbatim when exactly at limit", () => {
    const input = "x".repeat(1000);
    expect(truncateTranscriptForLive(input, 1000)).toBe(input);
  });

  test("returns empty string unchanged", () => {
    expect(truncateTranscriptForLive("", 100)).toBe("");
  });
});
