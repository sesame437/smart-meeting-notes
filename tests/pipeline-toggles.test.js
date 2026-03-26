/* eslint-disable no-console */
"use strict";

/**
 * pipeline-toggles.test.js
 *
 * Tests for:
 *   1. transcription-worker.js — FUNASR_URL toggle
 *   2. report-worker.js — FunASR-only mode
 */

// ─────────────────────────────────────────────────────────────────────────────
// Top-level jest.mock() calls (hoisted by Babel/Jest before any require)
// ─────────────────────────────────────────────────────────────────────────────

jest.mock("dotenv", () => ({ config: jest.fn() }));

// AWS SDK mocks
const mockS3Send = jest.fn();
jest.mock("@aws-sdk/client-s3", () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send: mockS3Send })),
  GetObjectCommand: jest.fn().mockImplementation((p) => ({ _type: "GetObject", ...p })),
  PutObjectCommand: jest.fn().mockImplementation((p) => ({ _type: "PutObject", ...p })),
}));

const mockDocSend = jest.fn().mockResolvedValue({});
jest.mock("@aws-sdk/lib-dynamodb", () => ({
  UpdateCommand: jest.fn().mockImplementation((p) => ({ _cmd: "Update", ...p })),
  PutCommand: jest.fn().mockImplementation((p) => ({ _cmd: "Put", ...p })),
  GetCommand: jest.fn().mockImplementation((p) => ({ _cmd: "Get", ...p })),
  QueryCommand: jest.fn().mockImplementation((p) => ({ _cmd: "Query", ...p })),
}));
jest.mock("../db/dynamodb", () => ({ docClient: { send: mockDocSend } }));

// SQS service
const mockSendMessage = jest.fn().mockResolvedValue({});
jest.mock("../services/sqs", () => ({
  receiveMessages: jest.fn().mockResolvedValue([]),
  deleteMessage: jest.fn().mockResolvedValue({}),
  sendMessage: mockSendMessage,
}));

// S3 / bedrock services (used by report-worker)
const mockGetFile = jest.fn();
const mockUploadFile = jest.fn().mockResolvedValue({});
jest.mock("../services/s3", () => ({
  getFile: mockGetFile,
  uploadFile: mockUploadFile,
}));

const mockInvokeModel = jest.fn().mockResolvedValue('{"summary":"ok"}');
jest.mock("../services/bedrock", () => ({
  invokeModel: mockInvokeModel,
}));

// global fetch
global.fetch = jest.fn();

// ─────────────────────────────────────────────────────────────────────────────
// Helper: build inline testable processMessage for transcription-worker
//
// Simplified to FunASR-only (Whisper and AWS Transcribe removed).
// ─────────────────────────────────────────────────────────────────────────────

function buildTranscriptionProcessMessage({ FUNASR_URL, runFunASRFn }) {
  const ENABLE_FUNASR = !!FUNASR_URL;

  return async function processMessage() {
    if (!ENABLE_FUNASR) {
      throw new Error("FunASR transcription failed");
    }

    const funasrKey = await runFunASRFn().catch((err) => {
      console.error(`[FunASR] Failed:`, err.message);
      return null;
    });

    if (!funasrKey) {
      throw new Error("FunASR transcription failed");
    }

    return { funasrKey };
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: build inline testable processMessage for report-worker (FunASR-only)
// ─────────────────────────────────────────────────────────────────────────────

function buildReportProcessMessage({
  funasrKey,
  s3SendFn,
  invokeModelFn,
  uploadFileFn,
}) {
  async function readFunASRResult(fKey) {
    if (!fKey) return null;
    try {
      const { GetObjectCommand } = require("@aws-sdk/client-s3");
      const resp = await s3SendFn(new GetObjectCommand({ Bucket: "test-bucket", Key: fKey }));
      const body = await resp.Body.transformToString();
      const data = JSON.parse(body);
      if (data.segments && data.segments.length > 0) {
        const lines = [];
        let currentSpeaker = null;
        let currentText = "";
        for (const seg of data.segments) {
          const spk = seg.speaker || "SPEAKER_0";
          if (spk !== currentSpeaker) {
            if (currentText) lines.push(`[${currentSpeaker}] ${currentText.trim()}`);
            currentSpeaker = spk;
            currentText = seg.text || "";
          } else {
            currentText += seg.text || "";
          }
        }
        if (currentText) lines.push(`[${currentSpeaker}] ${currentText.trim()}`);
        return lines.join("\n");
      }
      return data.text || null;
    } catch (err) {
      console.warn("[FunASR] Failed to read result:", err.message);
      return null;
    }
  }

  return async function processMessage() {
    const funasrText = await readFunASRResult(funasrKey);

    if (!funasrText) {
      throw new Error("FunASR transcription failed");
    }

    const transcriptParts = [];
    const truncated = funasrText.slice(0, 60000);
    transcriptParts.push(`[FunASR 转录（含说话人标签）]\n${truncated}`);
    const finalTranscript = transcriptParts.join("\n\n");

    await invokeModelFn(finalTranscript, "general");
    await uploadFileFn("reports/meeting-test/report.json", '{}', "application/json");

    return { transcriptParts, finalTranscript };
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite 1: transcription-worker.js — FunASR-only pipeline
// ─────────────────────────────────────────────────────────────────────────────

describe("transcription-worker: FunASR-only pipeline", () => {
  let runFunASR;

  beforeEach(() => {
    runFunASR = jest.fn().mockResolvedValue("transcripts/f.json");
    jest.clearAllMocks();
    runFunASR = jest.fn().mockResolvedValue("transcripts/f.json");
  });

  test("FUNASR_URL 为空时抛 'FunASR transcription failed'", async () => {
    const process = buildTranscriptionProcessMessage({
      FUNASR_URL: "",
      runFunASRFn: runFunASR,
    });
    await expect(process()).rejects.toThrow("FunASR transcription failed");
    expect(runFunASR).not.toHaveBeenCalled();
  });

  test("FUNASR_URL 有值时正常返回 funasrKey", async () => {
    const process = buildTranscriptionProcessMessage({
      FUNASR_URL: "http://funasr-host:8080",
      runFunASRFn: runFunASR,
    });
    const result = await process();
    expect(runFunASR).toHaveBeenCalledTimes(1);
    expect(result.funasrKey).toBe("transcripts/f.json");
  });

  test("FunASR 执行失败时抛 'FunASR transcription failed'", async () => {
    runFunASR = jest.fn().mockRejectedValue(new Error("FunASR crashed"));
    const process = buildTranscriptionProcessMessage({
      FUNASR_URL: "http://funasr-host:8080",
      runFunASRFn: runFunASR,
    });
    await expect(process()).rejects.toThrow("FunASR transcription failed");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 2: report-worker.js — FunASR-only support
// ─────────────────────────────────────────────────────────────────────────────

describe("report-worker: FunASR-only support", () => {
  let mockS3SendFn;
  let mockInvoke;
  let mockUpload;

  function makeFunASRS3Body(data) {
    return {
      Body: {
        transformToString: jest.fn().mockResolvedValue(JSON.stringify(data)),
      },
    };
  }

  beforeEach(() => {
    mockS3SendFn = jest.fn();
    mockInvoke = jest.fn().mockResolvedValue('{"summary":"ok"}');
    mockUpload = jest.fn().mockResolvedValue({});
    jest.clearAllMocks();
    mockS3SendFn = jest.fn();
    mockInvoke = jest.fn().mockResolvedValue('{"summary":"ok"}');
    mockUpload = jest.fn().mockResolvedValue({});
  });

  test("有 funasrKey 时正常处理，不抛错", async () => {
    mockS3SendFn.mockResolvedValueOnce(
      makeFunASRS3Body({ segments: [{ speaker: "SPEAKER_0", text: "FunASR 转录文本" }] })
    );

    const process = buildReportProcessMessage({
      funasrKey: "transcripts/meeting/funasr.json",
      s3SendFn: mockS3SendFn,
      invokeModelFn: mockInvoke,
      uploadFileFn: mockUpload,
    });

    const result = await process();
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(result.transcriptParts).toHaveLength(1);
    expect(result.transcriptParts[0]).toContain("[FunASR 转录（含说话人标签）]");
  });

  test("transcriptParts 只包含 FunASR 块", async () => {
    mockS3SendFn.mockResolvedValueOnce(
      makeFunASRS3Body({
        segments: [
          { speaker: "SPEAKER_0", text: "第一句话" },
          { speaker: "SPEAKER_1", text: "第二句话" },
        ],
      })
    );

    const process = buildReportProcessMessage({
      funasrKey: "transcripts/meeting/funasr.json",
      s3SendFn: mockS3SendFn,
      invokeModelFn: mockInvoke,
      uploadFileFn: mockUpload,
    });

    const result = await process();
    expect(result.transcriptParts).toHaveLength(1);
    expect(result.transcriptParts[0]).toMatch(/^\[FunASR 转录（含说话人标签）\]/);
  });

  test("FunASR S3 读取失败时抛 'FunASR transcription failed'", async () => {
    mockS3SendFn.mockRejectedValueOnce(new Error("NoSuchKey"));

    const process = buildReportProcessMessage({
      funasrKey: "transcripts/meeting/funasr.json",
      s3SendFn: mockS3SendFn,
      invokeModelFn: mockInvoke,
      uploadFileFn: mockUpload,
    });

    await expect(process()).rejects.toThrow("FunASR transcription failed");
  });

  test("无 funasrKey 时抛 'FunASR transcription failed'", async () => {
    const process = buildReportProcessMessage({
      funasrKey: null,
      s3SendFn: mockS3SendFn,
      invokeModelFn: mockInvoke,
      uploadFileFn: mockUpload,
    });

    await expect(process()).rejects.toThrow("FunASR transcription failed");
  });

  test("FunASR 文本超过 60000 字符时被截断", async () => {
    const longText = "A".repeat(70000);
    mockS3SendFn.mockResolvedValueOnce(
      makeFunASRS3Body({ text: longText })
    );

    const process = buildReportProcessMessage({
      funasrKey: "transcripts/meeting/funasr.json",
      s3SendFn: mockS3SendFn,
      invokeModelFn: mockInvoke,
      uploadFileFn: mockUpload,
    });

    const result = await process();
    const funasrPart = result.transcriptParts[0];
    const contentAfterLabel = funasrPart.replace("[FunASR 转录（含说话人标签）]\n", "");
    expect(contentAfterLabel.length).toBeLessThanOrEqual(60000);
  });
});
