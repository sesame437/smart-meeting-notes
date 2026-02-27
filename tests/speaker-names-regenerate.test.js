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
  uploadFile: jest.fn().mockResolvedValue("reports/m1/report.json"),
  getFile: jest.fn(),
}));

jest.mock("../services/sqs", () => ({
  sendMessage: jest.fn(),
}));

jest.mock("../services/bedrock", () => ({
  invokeModel: jest.fn(),
}));

const router = require("../routes/meetings/index");
const { getFile } = require("../services/s3");
const { invokeModel } = require("../services/bedrock");

function getRouteHandler(path, method) {
  const layer = router.stack.find(
    (l) => l.route && l.route.path === path && l.route.methods[method]
  );
  if (!layer) throw new Error(`${method.toUpperCase()} ${path} route not found`);
  return layer.route.stack[0].handle;
}

function createRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

describe("PUT /api/meetings/:id/speaker-names", () => {
  beforeEach(() => { mockSend.mockReset(); });

  test("saves speakerMap without triggering Bedrock", async () => {
    // getMeetingById → QueryCommand returns item
    mockSend.mockResolvedValueOnce({ Items: [{ meetingId: "m1", createdAt: "2026-01-01" }] });
    // UpdateCommand succeeds
    mockSend.mockResolvedValueOnce({});

    const handler = getRouteHandler("/:id/speaker-names", "put");
    const req = { params: { id: "m1" }, body: { speakerMap: { "SPEAKER_0": "Alice" } } };
    const res = createRes();
    const next = jest.fn();

    await handler(req, res, next);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(invokeModel).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  test("returns 400 for empty speakerMap", async () => {
    const handler = getRouteHandler("/:id/speaker-names", "put");
    const req = { params: { id: "m1" }, body: { speakerMap: {} } };
    const res = createRes();
    const next = jest.fn();

    await handler(req, res, next);

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/empty/i);
  });

  test("returns 400 for non-object speakerMap", async () => {
    const handler = getRouteHandler("/:id/speaker-names", "put");
    const req = { params: { id: "m1" }, body: { speakerMap: "bad" } };
    const res = createRes();
    const next = jest.fn();

    await handler(req, res, next);

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/object/i);
  });

  test("returns 404 if meeting not found", async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });
    const handler = getRouteHandler("/:id/speaker-names", "put");
    const req = { params: { id: "missing" }, body: { speakerMap: { "S0": "A" } } };
    const res = createRes();
    const next = jest.fn();

    await handler(req, res, next);

    expect(res.statusCode).toBe(404);
  });
});

describe("POST /api/meetings/:id/regenerate", () => {
  beforeEach(() => {
    mockSend.mockReset();
    invokeModel.mockReset();
    getFile.mockReset();
  });

  test("returns 404 if meeting not found", async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });
    const handler = getRouteHandler("/:id/regenerate", "post");
    const req = { params: { id: "missing" }, body: {} };
    const res = createRes();
    const next = jest.fn();

    await handler(req, res, next);

    expect(res.statusCode).toBe(404);
  });

  test("returns 400 if no transcript keys", async () => {
    mockSend.mockResolvedValueOnce({ Items: [{ meetingId: "m1", createdAt: "2026-01-01" }] });
    const handler = getRouteHandler("/:id/regenerate", "post");
    const req = { params: { id: "m1" }, body: {} };
    const res = createRes();
    const next = jest.fn();

    await handler(req, res, next);

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/No transcript/i);
  });

  test("calls Bedrock with stored speakerMap and returns report", async () => {
    const meetingItem = {
      meetingId: "m1",
      createdAt: "2026-01-01",
      funasrKey: "transcripts/m1/funasr.json",
      speakerMap: { "SPEAKER_0": "Alice" },
      meetingType: "general",
    };
    // getMeetingById
    mockSend.mockResolvedValueOnce({ Items: [meetingItem] });

    // getFile for funasrKey
    const funasrData = JSON.stringify({ text: "Hello this is the transcript" });
    getFile.mockResolvedValueOnce((async function* () { yield Buffer.from(funasrData); })());

    // glossary scan
    mockSend.mockResolvedValueOnce({ Items: [] });

    // invokeModel
    const reportJson = { summary: "Test summary", actions: [], participants: [] };
    invokeModel.mockResolvedValueOnce(JSON.stringify(reportJson));

    // uploadFile already mocked to return key
    // UpdateCommand for report save
    mockSend.mockResolvedValueOnce({});

    const handler = getRouteHandler("/:id/regenerate", "post");
    const req = { params: { id: "m1" }, body: {} };
    const res = createRes();
    const next = jest.fn();

    await handler(req, res, next);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.report).toEqual(reportJson);
    expect(invokeModel).toHaveBeenCalledWith(
      expect.stringContaining("Hello this is the transcript"),
      "general",
      [],
      undefined,
      { "SPEAKER_0": "Alice" }
    );
  });
});
