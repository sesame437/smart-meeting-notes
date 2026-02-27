"use strict";

process.env.DYNAMODB_TABLE = process.env.DYNAMODB_TABLE || "meeting-minutes-meetings";

const mockSend = jest.fn();

jest.mock("../db/dynamodb", () => ({
  docClient: { send: mockSend },
}));

jest.mock("@aws-sdk/lib-dynamodb", () => ({
  ScanCommand: jest.fn((p) => ({ _cmd: "ScanCommand", ...p })),
  QueryCommand: jest.fn((p) => ({ _cmd: "QueryCommand", ...p })),
  GetCommand: jest.fn((p) => ({ _cmd: "GetCommand", ...p })),
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

describe("PUT /api/meetings/:id/speaker-map error scenarios", () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  test("meetingId 不存在返回 404", async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });
    const handler = getSpeakerMapPutHandler();
    const req = { params: { id: "not-found-id" }, body: { speakerMap: { SPEAKER_0: "Alice" } } };
    const res = createRes();
    const next = jest.fn();

    await handler(req, res, next);

    expect(res.statusCode).toBe(404);
    expect(res.body.error).toBe("Not found");
    expect(next).not.toHaveBeenCalled();
  });

  test("speakerMap 不是对象返回 400", async () => {
    const handler = getSpeakerMapPutHandler();
    const req = { params: { id: "m1" }, body: { speakerMap: "not-an-object" } };
    const res = createRes();
    const next = jest.fn();

    await handler(req, res, next);

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/speakerMap must be an object/i);
    expect(mockSend).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  test("speakerMap 为空对象应返回 400（入参校验）", async () => {
    const handler = getSpeakerMapPutHandler();
    const req = { params: { id: "m1" }, body: { speakerMap: {} } };
    const res = createRes();
    const next = jest.fn();

    await handler(req, res, next);

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/empty|不能为空|at least one/i);
    expect(mockSend).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });
});
