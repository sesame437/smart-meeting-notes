"use strict";

const {
  pruneNoiseSpeakers,
  DEFAULT_MIN_CHARS,
  DEFAULT_MIN_SHARE_RATIO,
  DEFAULT_KEEP_FLOOR,
} = require("../services/speaker-pruner");

function seg(speaker, text, durSec = 2) {
  return { speaker, text, start: 0, end: durSec };
}

function buildSegments(counts) {
  // counts: { speaker: [text1, text2, ...] }
  const out = [];
  Object.entries(counts).forEach(([spk, texts]) => {
    const speakerValue = /^\d+$/.test(spk) ? Number(spk) : spk;
    texts.forEach((t) => out.push(seg(speakerValue, t)));
  });
  return out;
}

describe("pruneNoiseSpeakers - defaults", () => {
  test("exports sensible defaults", () => {
    expect(DEFAULT_MIN_CHARS).toBe(100);
    expect(DEFAULT_MIN_SHARE_RATIO).toBe(0.01);
    expect(DEFAULT_KEEP_FLOOR).toBe(300);
  });
});

describe("pruneNoiseSpeakers - edge cases", () => {
  test("empty array returns empty result", () => {
    const result = pruneNoiseSpeakers([]);
    expect(result.segments).toEqual([]);
    expect(result.prunedSpeakers).toEqual([]);
  });

  test("null input returns empty result", () => {
    const result = pruneNoiseSpeakers(null);
    expect(result.segments).toEqual([]);
    expect(result.prunedSpeakers).toEqual([]);
  });

  test("undefined input returns empty result", () => {
    const result = pruneNoiseSpeakers(undefined);
    expect(result.segments).toEqual([]);
    expect(result.prunedSpeakers).toEqual([]);
  });

  test("single speaker is never pruned (even if below thresholds)", () => {
    // Tiny mono meeting: 50 chars, 100% share
    const segs = [seg(0, "就说了这么几句话还没到一百字阈值", 5)];
    const result = pruneNoiseSpeakers(segs);
    expect(result.prunedSpeakers).toEqual([]);
    expect(result.segments).toEqual(segs);
  });
});

describe("pruneNoiseSpeakers - pruning rules", () => {
  test("prunes speaker below minChars and below keepFloor (1-segment noise)", () => {
    // SPEAKER_9 case: 1 seg, 14 chars, ~0% share when paired with a huge speaker
    const segs = [
      ...Array(50).fill(0).map(() => seg(0, "一段长度适中的发言内容大约二十个字")), // 50*18 = 900 chars
      seg(9, "一这个会很这方这方那边是谁？"), // 14 chars
    ];
    const result = pruneNoiseSpeakers(segs);
    expect(result.prunedSpeakers).toHaveLength(1);
    expect(result.prunedSpeakers[0].speaker).toBe(9);
    expect(result.prunedSpeakers[0].chars).toBe(14);
    expect(result.segments.some((s) => s.speaker === 9)).toBe(false);
  });

  test("prunes speaker below minShareRatio and below keepFloor (spread-out noise)", () => {
    // SPEAKER_2 case: 101 chars but 0.47% share, below keepFloor=300
    // Dominant speaker: 21400 chars; noisy: 101 chars = 0.47%
    const bigText = "每段内容大约二十个字的正常发言". repeat(1); // 15 chars each
    const segs = [
      ...Array(1430).fill(0).map(() => seg(0, bigText)), // 1430 * 15 = 21450 chars
      ...Array(14).fill(0).map(() => seg(2, "嗯七")), // 14 * ~7 = ~100 chars
    ];
    const result = pruneNoiseSpeakers(segs);
    const pruned2 = result.prunedSpeakers.find((p) => p.speaker === 2);
    expect(pruned2).toBeDefined();
    expect(pruned2.chars).toBeGreaterThan(0);
    expect(pruned2.chars).toBeLessThan(DEFAULT_KEEP_FLOOR);
    expect(result.segments.some((s) => s.speaker === 2)).toBe(false);
  });

  test("keeps speaker above keepFloor even if below minShareRatio", () => {
    // Huge meeting, brief-but-substantial contributor: 400 chars in 100000-char meeting = 0.4%
    const longSeg = "一段较长的内容大约有一百字".repeat(10); // 130 chars
    const segs = [
      ...Array(770).fill(0).map(() => seg(0, longSeg)), // 770 * 130 = 100100 chars
      seg(5, "a".repeat(400)), // 400 chars, 0.4% share
    ];
    const result = pruneNoiseSpeakers(segs);
    // 400 >= keepFloor(300) → must be kept despite share < 1%
    expect(result.prunedSpeakers.find((p) => p.speaker === 5)).toBeUndefined();
    expect(result.segments.some((s) => s.speaker === 5)).toBe(true);
  });

  test("keeps speaker above minChars when share is tiny (keepFloor applies)", () => {
    // 150 chars (> minChars=100) but < keepFloor=300
    // share < 1% would normally trigger prune; but keepFloor test is: chars < 300 (AND)
    // So: chars >= minChars AND share < minShareRatio AND chars < keepFloor → prune (share triggered)
    const longSeg = "a".repeat(100);
    const segs = [
      ...Array(500).fill(0).map(() => seg(0, longSeg)), // 50000 chars
      seg(5, "b".repeat(150)), // 150 chars, 0.3% share
    ];
    const result = pruneNoiseSpeakers(segs);
    const pruned5 = result.prunedSpeakers.find((p) => p.speaker === 5);
    expect(pruned5).toBeDefined();
    expect(pruned5.chars).toBe(150);
  });

  test("does not prune speaker at exactly keepFloor chars", () => {
    const longSeg = "a".repeat(100);
    const segs = [
      ...Array(1000).fill(0).map(() => seg(0, longSeg)), // 100000 chars
      seg(5, "b".repeat(300)), // exactly keepFloor, 0.3% share
    ];
    const result = pruneNoiseSpeakers(segs);
    expect(result.prunedSpeakers.find((p) => p.speaker === 5)).toBeUndefined();
  });

  test("accepts custom thresholds via options", () => {
    const segs = [
      ...Array(100).fill(0).map(() => seg(0, "a".repeat(50))), // 5000 chars
      seg(5, "b".repeat(80)), // 80 chars, 1.6% share
    ];
    // Default: 80<100 AND 80<300 → prune
    expect(pruneNoiseSpeakers(segs).prunedSpeakers.find((p) => p.speaker === 5)).toBeDefined();
    // Custom: minChars=50 → 80>=50, AND share 1.6% > 1% → not triggered → keep
    const custom = pruneNoiseSpeakers(segs, { minChars: 50 });
    expect(custom.prunedSpeakers.find((p) => p.speaker === 5)).toBeUndefined();
  });
});

describe("pruneNoiseSpeakers - env toggle", () => {
  const OLD = process.env.SPEAKER_PRUNE_ENABLED;
  afterEach(() => {
    if (OLD === undefined) delete process.env.SPEAKER_PRUNE_ENABLED;
    else process.env.SPEAKER_PRUNE_ENABLED = OLD;
  });

  test("SPEAKER_PRUNE_ENABLED=false returns original segments unchanged", () => {
    process.env.SPEAKER_PRUNE_ENABLED = "false";
    const segs = [
      ...Array(1000).fill(0).map(() => seg(0, "a".repeat(20))), // 20000 chars
      seg(9, "噪"), // 1 char, trivial
    ];
    const result = pruneNoiseSpeakers(segs);
    expect(result.prunedSpeakers).toEqual([]);
    expect(result.segments).toEqual(segs);
  });

  test("SPEAKER_PRUNE_ENABLED=true (default) prunes normally", () => {
    process.env.SPEAKER_PRUNE_ENABLED = "true";
    const segs = [
      ...Array(1000).fill(0).map(() => seg(0, "a".repeat(20))), // 20000 chars
      seg(9, "噪"), // 1 char
    ];
    const result = pruneNoiseSpeakers(segs);
    expect(result.prunedSpeakers).toHaveLength(1);
  });
});

describe("pruneNoiseSpeakers - real-world case (meeting 91d9711c)", () => {
  // Mimics actual distribution from FunASR output
  test("prunes SPEAKER_2 (101 chars, 0.47%) and SPEAKER_9 (14 chars, 0.07%)", () => {
    // Build segments matching real meeting char counts
    const charBudgets = {
      0: 10075, 1: 2684, 2: 101, 3: 522, 4: 1595, 5: 1709,
      6: 1469, 7: 1625, 8: 1055, 9: 14, 10: 701,
    };
    const segs = [];
    Object.entries(charBudgets).forEach(([spk, totalChars]) => {
      const spkNum = Number(spk);
      // Spread chars across multiple segments (~20 chars each)
      const numSegs = Math.max(1, Math.ceil(totalChars / 20));
      const perSeg = Math.floor(totalChars / numSegs);
      for (let i = 0; i < numSegs; i++) {
        segs.push(seg(spkNum, "x".repeat(perSeg)));
      }
    });

    const result = pruneNoiseSpeakers(segs);
    const prunedIds = result.prunedSpeakers.map((p) => p.speaker).sort();
    expect(prunedIds).toEqual([2, 9]);
    // All other speakers kept
    const keptSpeakers = new Set(result.segments.map((s) => s.speaker));
    expect(keptSpeakers.has(2)).toBe(false);
    expect(keptSpeakers.has(9)).toBe(false);
    expect(keptSpeakers.has(3)).toBe(true); // lightest real (522 chars, 2.43%)
    expect(keptSpeakers.has(0)).toBe(true); // biggest
  });
});

describe("pruneNoiseSpeakers - string speaker labels", () => {
  test("handles string speaker labels (e.g. 'SPEAKER_0')", () => {
    const segs = [
      ...Array(100).fill(0).map(() => seg("SPEAKER_0", "a".repeat(200))),
      seg("SPEAKER_9", "b"), // 1 char
    ];
    const result = pruneNoiseSpeakers(segs);
    expect(result.prunedSpeakers).toHaveLength(1);
    expect(result.prunedSpeakers[0].speaker).toBe("SPEAKER_9");
  });
});

describe("pruneNoiseSpeakers - output shape", () => {
  test("each prunedSpeakers entry has speaker, chars, segs, share", () => {
    const segs = [
      ...Array(1000).fill(0).map(() => seg(0, "a".repeat(20))),
      ...Array(3).fill(0).map(() => seg(9, "bb")), // 6 chars, 3 segs
    ];
    const result = pruneNoiseSpeakers(segs);
    expect(result.prunedSpeakers).toHaveLength(1);
    const p = result.prunedSpeakers[0];
    expect(p).toHaveProperty("speaker", 9);
    expect(p).toHaveProperty("chars", 6);
    expect(p).toHaveProperty("segs", 3);
    expect(p).toHaveProperty("share");
    expect(p.share).toBeCloseTo(6 / (6 + 20000), 5);
  });
});

// Silence unused helper in some test files
void buildSegments;
