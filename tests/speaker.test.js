"use strict";

process.env.DYNAMODB_TABLE = process.env.DYNAMODB_TABLE || "meeting-minutes-meetings";

const mockSend = jest.fn();

jest.mock("../db/dynamodb", () => ({
  docClient: { send: mockSend },
}));

jest.mock("@aws-sdk/lib-dynamodb", () => ({
  ScanCommand: jest.fn((p) => ({ _cmd: "ScanCommand", ...p })),
  QueryCommand: jest.fn((p) => ({ _cmd: "QueryCommand", ...p })),
  PutCommand: jest.fn((p) => ({ _cmd: "PutCommand", ...p })),
  UpdateCommand: jest.fn((p) => ({ _cmd: "UpdateCommand", ...p })),
  DeleteCommand: jest.fn((p) => ({ _cmd: "DeleteCommand", ...p })),
}));

jest.mock("../services/s3", () => ({
  uploadFile: jest.fn(),
  getFile: jest.fn(),
}));

jest.mock("../services/sqs", () => ({
  sendMessage: jest.fn(),
}));

jest.mock("../services/bedrock", () => ({
  invokeModel: jest.fn(),
}));

const { getFile, uploadFile } = require("../services/s3");
const { invokeModel } = require("../services/bedrock");
const router = require("../routes/meetings/index");

function getSpeakerMapPutHandler() {
  const layer = router.stack.find(
    (l) => l.route && l.route.path === "/:id/speaker-map" && l.route.methods.put
  );
  if (!layer) throw new Error("speaker-map route not found");
  return layer.route.stack[0].handle;
}

function createRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

function createAsyncStream(chunks) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) {
        yield Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      }
    },
  };
}

describe("PUT /api/meetings/:id/speaker-map", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("正常保存（key=participant label，value=真实姓名）返回 { success: true }", async () => {
    mockSend
      .mockResolvedValueOnce({
        Items: [{
          meetingId: "m1",
          createdAt: "2026-02-26T10:00:00.000Z",
          meetingType: "general",
          funasrKey: "transcripts/m1/funasr.json",
        }],
      })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({});

    getFile.mockImplementation(async () => createAsyncStream([
      JSON.stringify({
        segments: [
          { speaker: "SPEAKER_0", text: "今天讨论预算。" },
          { speaker: "SPEAKER_1", text: "同意。" },
        ],
      }),
    ]));

    invokeModel.mockResolvedValue('{"summary":"ok","actionItems":[]}');
    uploadFile.mockResolvedValue("reports/m1/report.json");

    const handler = getSpeakerMapPutHandler();
    const req = {
      params: { id: "m1" },
      body: { speakerMap: { SPEAKER_0: "张三", SPEAKER_1: "李四" } },
    };
    const res = createRes();
    const next = jest.fn();

    await handler(req, res, next);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ success: true });
    expect(getFile).toHaveBeenCalledWith("transcripts/m1/funasr.json");
    expect(invokeModel).toHaveBeenCalled();
    expect(uploadFile).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  test("key 为空字符串返回 400", async () => {
    const handler = getSpeakerMapPutHandler();
    const req = {
      params: { id: "m1" },
      body: { speakerMap: { "": "张三" } },
    };
    const res = createRes();
    const next = jest.fn();

    await handler(req, res, next);

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/key must be a non-empty string/i);
    expect(mockSend).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  test("value 超过 100 字符返回 400", async () => {
    const longName = "a".repeat(101);
    const handler = getSpeakerMapPutHandler();
    const req = {
      params: { id: "m1" },
      body: { speakerMap: { SPEAKER_0: longName } },
    };
    const res = createRes();
    const next = jest.fn();

    await handler(req, res, next);

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/at most 100 characters/i);
    expect(mockSend).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  test("speakerMap 为空返回 400", async () => {
    const handler = getSpeakerMapPutHandler();
    const req = {
      params: { id: "m1" },
      body: { speakerMap: {} },
    };
    const res = createRes();
    const next = jest.fn();

    await handler(req, res, next);

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/cannot be empty/i);
    expect(mockSend).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  test("meeting 不存在返回 404", async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const handler = getSpeakerMapPutHandler();
    const req = {
      params: { id: "missing" },
      body: { speakerMap: { SPEAKER_0: "张三" } },
    };
    const res = createRes();
    const next = jest.fn();

    await handler(req, res, next);

    expect(res.statusCode).toBe(404);
    expect(res.body.error).toBe("Not found");
    expect(next).not.toHaveBeenCalled();
  });

  test("No transcript found 分支：FunASR JSON 含 segments 但为空时返回 400", async () => {
    mockSend
      .mockResolvedValueOnce({
        Items: [{
          meetingId: "m2",
          createdAt: "2026-02-26T10:00:00.000Z",
          meetingType: "general",
          funasrKey: "transcripts/m2/funasr.json",
        }],
      })
      .mockResolvedValueOnce({});

    getFile.mockImplementation(async () => createAsyncStream([
      JSON.stringify({ segments: [] }),
    ]));

    const handler = getSpeakerMapPutHandler();
    const req = {
      params: { id: "m2" },
      body: { speakerMap: { SPEAKER_0: "张三" } },
    };
    const res = createRes();
    const next = jest.fn();

    await handler(req, res, next);

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/No transcript found/i);
    expect(getFile).toHaveBeenCalledWith("transcripts/m2/funasr.json");
    expect(next).not.toHaveBeenCalled();
  });
});
