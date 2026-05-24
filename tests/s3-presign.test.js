"use strict";

const mockGetSignedUrl = jest.fn();
jest.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: (...args) => mockGetSignedUrl(...args),
}));

process.env.AWS_REGION = "us-west-2";
process.env.S3_BUCKET = "test-bucket";
process.env.S3_PREFIX = "meeting-minutes";

const { getPresignedDownloadUrl } = require("../services/s3");

beforeEach(() => {
  jest.clearAllMocks();
});

describe("getPresignedDownloadUrl", () => {
  test("auto-prefixes bare key and signs GetObjectCommand", async () => {
    mockGetSignedUrl.mockResolvedValueOnce("https://signed.example/url");

    const url = await getPresignedDownloadUrl("transcripts/abc/transcript.txt");

    expect(url).toBe("https://signed.example/url");
    expect(mockGetSignedUrl).toHaveBeenCalledTimes(1);
    const [, command, opts] = mockGetSignedUrl.mock.calls[0];
    expect(command.input.Bucket).toBe("test-bucket");
    expect(command.input.Key).toBe("meeting-minutes/transcripts/abc/transcript.txt");
    expect(opts).toEqual({ expiresIn: 900 });
  });

  test("does not double-prefix when key already starts with PREFIX", async () => {
    mockGetSignedUrl.mockResolvedValueOnce("https://signed/x");

    await getPresignedDownloadUrl("meeting-minutes/transcripts/abc/transcript.txt");

    const [, command] = mockGetSignedUrl.mock.calls[0];
    expect(command.input.Key).toBe("meeting-minutes/transcripts/abc/transcript.txt");
  });

  test("uses custom expiresIn when provided", async () => {
    mockGetSignedUrl.mockResolvedValueOnce("https://signed/x");

    await getPresignedDownloadUrl("transcripts/abc/transcript.txt", { expiresIn: 60 });

    const [, , opts] = mockGetSignedUrl.mock.calls[0];
    expect(opts).toEqual({ expiresIn: 60 });
  });

  test("default expiresIn is 900 seconds", async () => {
    mockGetSignedUrl.mockResolvedValueOnce("https://signed/x");

    await getPresignedDownloadUrl("transcripts/abc/transcript.txt", {});

    const [, , opts] = mockGetSignedUrl.mock.calls[0];
    expect(opts).toEqual({ expiresIn: 900 });
  });
});
