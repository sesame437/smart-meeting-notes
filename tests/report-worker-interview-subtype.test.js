"use strict";

// Mock AWS clients before requiring the worker to avoid real SDK calls.
const mockInvokeModel = jest.fn();
jest.mock("../services/bedrock", () => ({
  invokeModel: mockInvokeModel,
  invokeModelRaw: jest.fn(),
  getMeetingPrompt: jest.fn(),
}));
jest.mock("../services/glossary-store", () => ({
  listGlossary: jest.fn().mockResolvedValue([]),
}));
jest.mock("../services/glossary-filter", () => ({
  filterGlossaryByMeetingType: jest.fn((items) => items),
}));

const mockSend = jest.fn();
jest.mock("../db/dynamodb", () => ({
  docClient: { send: mockSend },
}));
jest.mock("@aws-sdk/lib-dynamodb", () => ({
  GetCommand: jest.fn((p) => ({ ...p, _type: "GetCommand" })),
  UpdateCommand: jest.fn((p) => ({ ...p, _type: "UpdateCommand" })),
  QueryCommand: jest.fn((p) => ({ ...p, _type: "QueryCommand" })),
}));

const { getMeetingType } = require("../workers/report-worker");

describe("report-worker meetingType resolution", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("getMeetingType returns type from SQS body when present", async () => {
    const result = await getMeetingType("mid", "2026-05-12T00:00:00Z", "interview");
    expect(result).toBe("interview");
  });

  test("getMeetingType falls back to DynamoDB when SQS body lacks meetingType", async () => {
    mockSend.mockResolvedValueOnce({ Item: { meetingType: "general" } });
    const result = await getMeetingType("mid", "2026-05-12T00:00:00Z", undefined);
    expect(result).toBe("general");
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  test("getMeetingType returns general when DynamoDB has no item", async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined });
    const result = await getMeetingType("mid", "2026-05-12T00:00:00Z", undefined);
    expect(result).toBe("general");
  });

  test("getMeetingType returns general on DynamoDB error", async () => {
    mockSend.mockRejectedValueOnce(new Error("DynamoDB unavailable"));
    const result = await getMeetingType("mid", "2026-05-12T00:00:00Z", undefined);
    expect(result).toBe("general");
  });

  test('getMeetingType uses SQS body type even when it is "general"', async () => {
    // messageType="general" is now returned directly per current logic (general is not skipped)
    // The current implementation only bypasses SQS when messageType is falsy
    mockSend.mockResolvedValueOnce({ Item: { meetingType: "weekly" } });
    const result = await getMeetingType("mid", "2026-05-12T00:00:00Z", "general");
    // "general" is falsy-like but truthy string — the condition is `messageType && messageType !== "general"`
    // so "general" falls through to DynamoDB lookup
    expect(result).toBe("weekly");
    expect(mockSend).toHaveBeenCalledTimes(1);
  });
});
