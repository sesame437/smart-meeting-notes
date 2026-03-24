"use strict";

/**
 * Tests for parseMessage() S3 Event strip-prefix logic
 * in workers/transcription-worker.js.
 *
 * parseMessage is not exported, so we replicate its pure logic here
 * to verify the PREFIX-stripping algorithm in isolation.
 */

const { randomUUID } = require("crypto");

// Replicate parseMessage logic exactly as in transcription-worker.js
function parseMeetingTypeFromFilename(filename) {
  if (filename.startsWith("weekly__")) return "weekly";
  if (filename.startsWith("tech__")) return "tech";
  return "general";
}

function parseMessage(body, prefix = "meeting-minutes") {
  // S3 Event Notification format
  if (body.Records && body.Records[0] && body.Records[0].s3) {
    const s3Event = body.Records[0].s3;
    const s3Key = decodeURIComponent(s3Event.object.key.replace(/\+/g, " "));
    const filename = s3Key.split("/").pop();
    const meetingId = randomUUID();
    const meetingType = parseMeetingTypeFromFilename(filename);
    // Strip PREFIX from s3Key for consistent storage
    const PREFIX_PATH = prefix + "/";
    const bareS3Key = s3Key.startsWith(PREFIX_PATH) ? s3Key.slice(PREFIX_PATH.length) : s3Key;
    return { meetingId, s3Key: bareS3Key, filename, meetingType, isS3Event: true };
  }

  // Internal format
  return {
    meetingId: body.meetingId,
    s3Key: body.s3Key,
    filename: body.filename,
    meetingType: body.meetingType || "general",
    isS3Event: false,
  };
}

// Helper to build an S3 Event body
function makeS3EventBody(key) {
  return {
    Records: [
      {
        s3: {
          bucket: { name: "yc-projects-012289836917" },
          object: { key },
        },
      },
    ],
  };
}

// ─────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────

describe("parseMessage — S3 Event strip prefix", () => {
  test("S3 Event key WITH prefix → strips prefix to bare key", () => {
    const body = makeS3EventBody("meeting-minutes/inbox/abc-123/recording.mp3");
    const result = parseMessage(body);

    expect(result.s3Key).toBe("inbox/abc-123/recording.mp3");
    expect(result.filename).toBe("recording.mp3");
    expect(result.isS3Event).toBe(true);
    expect(result.meetingId).toBeDefined();
    expect(result.meetingType).toBe("general");
  });

  test("S3 Event key WITHOUT prefix → bare key unchanged (idempotent)", () => {
    const body = makeS3EventBody("inbox/abc-123/recording.mp3");
    const result = parseMessage(body);

    expect(result.s3Key).toBe("inbox/abc-123/recording.mp3");
    expect(result.filename).toBe("recording.mp3");
    expect(result.isS3Event).toBe(true);
  });

  test("S3 Event key with URL-encoded characters → properly decoded", () => {
    const body = makeS3EventBody("meeting-minutes/inbox/abc-123/%E4%BC%9A%E8%AE%AE.mp3");
    const result = parseMessage(body);

    expect(result.s3Key).toBe("inbox/abc-123/会议.mp3");
    expect(result.filename).toBe("会议.mp3");
  });

  test("S3 Event key with '+' (space encoding) → decoded to space", () => {
    const body = makeS3EventBody("meeting-minutes/inbox/abc-123/my+recording.mp3");
    const result = parseMessage(body);

    expect(result.s3Key).toBe("inbox/abc-123/my recording.mp3");
    expect(result.filename).toBe("my recording.mp3");
  });

  test("S3 Event with weekly__ filename → meetingType = weekly", () => {
    const body = makeS3EventBody("meeting-minutes/inbox/abc-123/weekly__standup.mp3");
    const result = parseMessage(body);

    expect(result.meetingType).toBe("weekly");
  });

  test("S3 Event with tech__ filename → meetingType = tech", () => {
    const body = makeS3EventBody("meeting-minutes/inbox/abc-123/tech__review.mp3");
    const result = parseMessage(body);

    expect(result.meetingType).toBe("tech");
  });
});

describe("parseMessage — internal SQS message (non-S3 Event)", () => {
  test("internal message → s3Key returned as-is, isS3Event = false", () => {
    const body = {
      meetingId: "test-meeting-id",
      s3Key: "inbox/test-meeting-id/file.mp3",
      filename: "file.mp3",
      meetingType: "tech",
    };
    const result = parseMessage(body);

    expect(result.s3Key).toBe("inbox/test-meeting-id/file.mp3");
    expect(result.meetingId).toBe("test-meeting-id");
    expect(result.filename).toBe("file.mp3");
    expect(result.meetingType).toBe("tech");
    expect(result.isS3Event).toBe(false);
  });

  test("internal message without meetingType → defaults to general", () => {
    const body = {
      meetingId: "test-id",
      s3Key: "inbox/test-id/file.mp3",
    };
    const result = parseMessage(body);

    expect(result.meetingType).toBe("general");
    expect(result.isS3Event).toBe(false);
  });

  test("internal message with empty Records array → treated as internal", () => {
    const body = {
      Records: [],
      meetingId: "fallback-id",
      s3Key: "inbox/fallback-id/file.mp3",
    };
    const result = parseMessage(body);

    expect(result.isS3Event).toBe(false);
    expect(result.meetingId).toBe("fallback-id");
  });
});

describe("parseMessage — custom prefix", () => {
  test("custom prefix stripped correctly", () => {
    const body = makeS3EventBody("custom-prefix/inbox/abc/file.mp3");
    const result = parseMessage(body, "custom-prefix");

    expect(result.s3Key).toBe("inbox/abc/file.mp3");
  });

  test("mismatched prefix → key unchanged", () => {
    const body = makeS3EventBody("other-prefix/inbox/abc/file.mp3");
    const result = parseMessage(body, "meeting-minutes");

    expect(result.s3Key).toBe("other-prefix/inbox/abc/file.mp3");
  });
});
