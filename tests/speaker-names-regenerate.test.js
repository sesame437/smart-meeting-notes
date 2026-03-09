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
    const req = {
      params: { id: "m1" },
      body: {
        speakerMap: { "SPEAKER_0": "Alice" },
        speakerAliases: { "SPEAKER_0": ["主持人"] },
      },
    };
    const res = createRes();
    const next = jest.fn();

    await handler(req, res, next);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(mockSend).toHaveBeenLastCalledWith(
      expect.objectContaining({
        _cmd: "UpdateCommand",
        ExpressionAttributeValues: expect.objectContaining({
          ":sa": { "SPEAKER_0": ["主持人"] },
        }),
      })
    );
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
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.message).toMatch(/empty/i);
  });

  test("returns 400 for non-object speakerMap", async () => {
    const handler = getRouteHandler("/:id/speaker-names", "put");
    const req = { params: { id: "m1" }, body: { speakerMap: "bad" } };
    const res = createRes();
    const next = jest.fn();

    await handler(req, res, next);

    expect(res.statusCode).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.message).toMatch(/expected record|invalid.*type/i);
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
    expect(res.body.error.code).toBe("NO_TRANSCRIPT");
    expect(res.body.error.message).toMatch(/No transcript/i);
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

describe("POST /api/meetings/:id/apply-speaker-names", () => {
  beforeEach(() => {
    mockSend.mockReset();
    getFile.mockReset();
  });

  test("updates DynamoDB content after applying speaker names", async () => {
    const meetingItem = {
      meetingId: "m1",
      createdAt: "2026-01-01",
      reportKey: "reports/m1/report.json",
      speakerMap: { SPEAKER_0: "Alice" },
      speakerAliases: { SPEAKER_0: ["主持人"] },
    };
    const reportJson = {
      summary: "SPEAKER_0 跟进事项",
      participants: ["主持人（SPEAKER_0）"],
      actions: [{ task: "同步项目", owner: "主持人（江海负责人）", deadline: "", priority: "high" }],
      speakerKeypoints: { SPEAKER_0: ["SPEAKER_0 说了重点"] },
    };

    mockSend
      .mockResolvedValueOnce({ Items: [meetingItem] })
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({});
    getFile.mockResolvedValueOnce((async function* () {
      yield Buffer.from(JSON.stringify(reportJson));
    })());

    const handler = getRouteHandler("/:id/apply-speaker-names", "post");
    const req = { params: { id: "m1" }, body: {} };
    const res = createRes();
    const next = jest.fn();

    await handler(req, res, next);

    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(mockSend).toHaveBeenLastCalledWith(
      expect.objectContaining({
        _cmd: "UpdateCommand",
        Key: { meetingId: "m1", createdAt: "2026-01-01" },
        ExpressionAttributeValues: expect.objectContaining({
          ":c": expect.objectContaining({
            summary: "Alice 跟进事项",
            participants: ["Alice"],
            speakerKeypoints: { SPEAKER_0: ["SPEAKER_0 说了重点"] },
            speakerRoster: [
              expect.objectContaining({
                speakerKey: "SPEAKER_0",
                displayLabel: "参会人 1",
                resolvedName: "Alice",
                possibleName: "主持人",
                keypoints: ["SPEAKER_0 说了重点"],
              }),
            ],
            actions: [{ task: "同步项目", owner: "Alice", deadline: "", priority: "high" }],
          }),
        }),
      })
    );
    expect(next).not.toHaveBeenCalled();
  });

  test("replaces owner aliases from stable speakerRoster even when participants are already normalized", async () => {
    const meetingItem = {
      meetingId: "m2",
      createdAt: "2026-01-02",
      reportKey: "reports/m2/report.json",
      speakerMap: { SPEAKER_1: "李龙" },
      speakerAliases: { SPEAKER_1: ["成员A", "参会人 2"] },
    };
    const reportJson = {
      summary: "参会人 2 需要跟进",
      participants: ["参会人 1", "参会人 2"],
      actions: [{ task: "同步项目", owner: "成员A（强哥）", deadline: "", priority: "high" }],
      speakerKeypoints: { SPEAKER_1: ["成员A 跟进客户迁移计划"] },
      speakerRoster: [
        {
          speakerKey: "SPEAKER_0",
          displayLabel: "参会人 1",
          possibleName: "主持人",
          aliases: ["主持人"],
          keypoints: [],
          resolvedName: "",
        },
        {
          speakerKey: "SPEAKER_1",
          displayLabel: "参会人 2",
          possibleName: "成员A",
          aliases: ["成员A", "成员A（强哥）", "参会人 2"],
          keypoints: ["成员A 跟进客户迁移计划"],
          resolvedName: "",
        },
      ],
    };

    mockSend
      .mockResolvedValueOnce({ Items: [meetingItem] })
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({});
    getFile.mockResolvedValueOnce((async function* () {
      yield Buffer.from(JSON.stringify(reportJson));
    })());

    const handler = getRouteHandler("/:id/apply-speaker-names", "post");
    const req = { params: { id: "m2" }, body: {} };
    const res = createRes();
    const next = jest.fn();

    await handler(req, res, next);

    expect(res.statusCode).toBe(200);
    expect(mockSend).toHaveBeenLastCalledWith(
      expect.objectContaining({
        ExpressionAttributeValues: expect.objectContaining({
          ":c": expect.objectContaining({
            summary: "李龙 需要跟进",
            participants: ["参会人 1", "李龙"],
            actions: [{ task: "同步项目", owner: "李龙", deadline: "", priority: "high" }],
            speakerRoster: expect.arrayContaining([
              expect.objectContaining({
                speakerKey: "SPEAKER_1",
                resolvedName: "李龙",
                possibleName: "成员A",
              }),
            ]),
          }),
        }),
      })
    );
    expect(next).not.toHaveBeenCalled();
  });

  test("collapses anonymous owner wrappers when roster aliases expose nested real-name hints", async () => {
    const meetingItem = {
      meetingId: "m3",
      createdAt: "2026-01-03",
      reportKey: "reports/m3/report.json",
      speakerMap: { SPEAKER_2: "梁睿" },
      speakerAliases: {},
    };
    const reportJson = {
      summary: "成员J（瑞远）需要跟进",
      participants: ["参会人 1", "参会人 2", "参会人 3"],
      actions: [{ task: "准备 kickoff", owner: "成员J（瑞远）", deadline: "", priority: "high" }],
      speakerKeypoints: { SPEAKER_2: ["推进 kickoff"] },
      speakerRoster: [
        {
          speakerKey: "梁睿",
          displayLabel: "参会人 3",
          possibleName: "成员F",
          aliases: ["成员F（SPEAKER_2，瑞总/瑞远，资深SA）", "成员F"],
          keypoints: ["推进 kickoff"],
          resolvedName: "",
        },
      ],
    };

    mockSend
      .mockResolvedValueOnce({ Items: [meetingItem] })
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({});
    getFile.mockResolvedValueOnce((async function* () {
      yield Buffer.from(JSON.stringify(reportJson));
    })());

    const handler = getRouteHandler("/:id/apply-speaker-names", "post");
    const req = { params: { id: "m3" }, body: {} };
    const res = createRes();
    const next = jest.fn();

    await handler(req, res, next);

    expect(res.statusCode).toBe(200);
    expect(mockSend).toHaveBeenLastCalledWith(
      expect.objectContaining({
        ExpressionAttributeValues: expect.objectContaining({
          ":c": expect.objectContaining({
            summary: "梁睿需要跟进",
            actions: [{ task: "准备 kickoff", owner: "梁睿", deadline: "", priority: "high" }],
            participants: ["梁睿"],
          }),
        }),
      })
    );
    expect(next).not.toHaveBeenCalled();
  });
});
