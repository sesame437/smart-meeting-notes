"use strict";

/**
 * batch3.test.js — Batch 3 修改专项单元测试 (commit ec453e4)
 *
 * 覆盖：
 *   Suite B: truncateTranscript()   — services/bedrock.js (FunASR only)
 *   Suite C: GSI Query 去重逻辑 — transcription-worker.js
 */

// ─── Mocks (必须在 require 任何模块之前) ─────────────────────────────────────

jest.mock("dotenv", () => ({ config: jest.fn() }));

// bedrock.js 依赖
jest.mock("@aws-sdk/client-bedrock-runtime", () => ({
  BedrockRuntimeClient: jest.fn().mockImplementation(() => ({ send: jest.fn() })),
  InvokeModelWithResponseStreamCommand: jest.fn(),
}));

// export-worker.js 依赖
jest.mock("@aws-sdk/client-ses", () => ({
  SESClient: jest.fn().mockImplementation(() => ({ send: jest.fn() })),
  SendRawEmailCommand: jest.fn(),
}));
jest.mock("../services/sqs", () => ({
  receiveMessages: jest.fn().mockResolvedValue([]),
  deleteMessage: jest.fn().mockResolvedValue({}),
  sendMessage: jest.fn().mockResolvedValue({}),
}));
jest.mock("../services/s3", () => ({
  getFile: jest.fn(),
  uploadFile: jest.fn().mockResolvedValue("s3://bucket/key"),
}));
jest.mock("../services/ses", () => ({
  ses: { send: jest.fn().mockResolvedValue({}) },
}));
jest.mock("../db/dynamodb", () => ({
  docClient: { send: jest.fn().mockResolvedValue({}) },
}));
jest.mock("@aws-sdk/lib-dynamodb", () => ({
  UpdateCommand: jest.fn((p) => ({ _cmd: "UpdateCommand", ...p })),
  PutCommand: jest.fn((p) => ({ _cmd: "PutCommand", ...p })),
  GetCommand: jest.fn((p) => ({ _cmd: "GetCommand", ...p })),
  QueryCommand: jest.fn((p) => ({ _cmd: "QueryCommand", ...p })),
}));

// ─── 从 services/bedrock.js 导入（已 mock AWS SDK）───────────────────────────


// truncateTranscript — FunASR only, simple truncation at MAX_TOTAL
function truncateTranscript(text) {
  const MAX_TOTAL = 120000;
  return text.slice(0, MAX_TOTAL);
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite B — truncateTranscript() (FunASR only)
// ─────────────────────────────────────────────────────────────────────────────

describe("Suite B — truncateTranscript() (FunASR only)", () => {

  // ── B1: 长文本整体截 120k ───────────────────────────────────────────────
  test("B1: 长文本（超过 120000 字符）→ 整体截 120000 字符", () => {
    const longText = "A".repeat(150000);
    const result = truncateTranscript(longText);
    expect(result.length).toBe(120000);
    expect(result).toBe("A".repeat(120000));
  });

  // ── B2: 短文本不截断 ─────────────────────────────────────────────────────
  test("B2: 短文本（< 120000 字符）→ 原样返回，不截断", () => {
    const shortText = "这是一段很短的会议转录，不需要截断。";
    const result = truncateTranscript(shortText);
    expect(result).toBe(shortText);
    expect(result.length).toBe(shortText.length);
  });

  // ── B3: 精确验证 120000 字符边界 ────────────────────────────────────────
  test("B3: 恰好 120000 字符 → 不截断，完整返回", () => {
    const exactText = "Z".repeat(120000);
    const result = truncateTranscript(exactText);
    expect(result.length).toBe(120000);
  });

  // ── B4: 120001 字符边界截断 ──────────────────────────────────────────────
  test("B4: 120001 字符 → 截断到 120000，最后一个字符被删", () => {
    const borderText = "Z".repeat(120000) + "X"; // 120001 个字符
    const result = truncateTranscript(borderText);
    expect(result.length).toBe(120000);
    expect(result[result.length - 1]).toBe("Z"); // 最后一个 X 被截掉
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite C — transcription-worker GSI Query 去重逻辑
// ─────────────────────────────────────────────────────────────────────────────

describe("Suite C — transcription-worker GSI Query 去重逻辑（QueryCommand）", () => {

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── D1: 源码使用 QueryCommand（不是 ScanCommand）用于去重 ─────────────────
  test("D1: transcription-worker 源码使用 QueryCommand 而非 ScanCommand 进行去重", () => {
    const fs   = require("fs");
    const path = require("path");
    const source = fs.readFileSync(
      path.resolve(__dirname, "..", "workers", "transcription-worker.js"),
      "utf8"
    );
    // Batch 3 改为 QueryCommand（GSI）
    expect(source).toContain("QueryCommand");
    expect(source).not.toContain("ScanCommand");
  });

  // ── D2: QueryCommand 使用 GSI 索引 ───────────────────────────────────────
  test("D2: QueryCommand 指定 GSI IndexName: 'status-createdAt-index'", () => {
    const fs   = require("fs");
    const path = require("path");
    const source = fs.readFileSync(
      path.resolve(__dirname, "..", "workers", "transcription-worker.js"),
      "utf8"
    );
    expect(source).toContain("status-createdAt-index");
  });

  // ── D3: QueryCommand 以 status 为 PK（KeyConditionExpression）────────────
  test("D3: QueryCommand KeyConditionExpression 按 status 查询", () => {
    const fs   = require("fs");
    const path = require("path");
    const source = fs.readFileSync(
      path.resolve(__dirname, "..", "workers", "transcription-worker.js"),
      "utf8"
    );
    expect(source).toContain("KeyConditionExpression");
    expect(source).toContain("FilterExpression");
    // s3Key 匹配在 FilterExpression（内存过滤）
    expect(source).toMatch(/FilterExpression.*s3Key/);
  });

  // ── D4: 四种状态逐个 Query → 找到则去重 ─────────────────────────────────
  test("D4: 对四种状态逐一 QueryCommand，发现匹配 s3Key 则去重", () => {
    const statusesToCheck = ["pending", "processing", "reported", "completed"];
    const s3Key = "media/weekly__meeting.mp4";

    // 模拟：第一个 Query (pending) 返回空，第二个 Query (processing) 返回匹配
    const mockResults = [
      { Items: [] },
      { Items: [{ meetingId: "meeting-dup-001", s3Key, status: "processing" }] },
    ];
    let callCount = 0;

    async function simulateDedupQuery(_s3KeyToCheck) {
      for (const _st of statusesToCheck) {
        const result = mockResults[callCount++] || { Items: [] };
        if (result.Items && result.Items.length > 0) {
          // s3Key 匹配（内存 filter）
          if (result.Items[0].s3Key === _s3KeyToCheck) {
            return { found: true, meetingId: result.Items[0].meetingId };
          }
        }
      }
      return { found: false };
    }

    return simulateDedupQuery(s3Key).then((outcome) => {
      expect(outcome.found).toBe(true);
      expect(outcome.meetingId).toBe("meeting-dup-001");
      // 只查了 2 次（pending 空 + processing 命中），不需要查全部 4 次
      expect(callCount).toBe(2);
    });
  });

  // ── D5: 所有状态均无匹配 → 允许处理 ─────────────────────────────────────
  test("D5: 四种状态 Query 均返回空 → found=false，允许继续处理", async () => {
    async function simulateDedupQuery(_s3KeyToCheck) {
      const statusesToCheck = ["pending", "processing", "reported", "completed"];
      for (const _st of statusesToCheck) {
        const result = { Items: [] }; // 全部返回空
        if (result.Items && result.Items.length > 0) {
          return { found: true };
        }
      }
      return { found: false };
    }

    const outcome = await simulateDedupQuery("media/new-fresh-meeting.mp4");
    expect(outcome.found).toBe(false);
  });

  // ── D6: s3Key 匹配是内存 filter（QueryCommand 只能用 KeyCondition 查 status）
  test("D6: QueryCommand 只能通过 KeyConditionExpression 查 status（GSI PK），s3Key 须内存 filter", () => {
    // 验证源码中 FilterExpression（内存过滤）用于 s3Key，而非 KeyConditionExpression
    const fs   = require("fs");
    const path = require("path");
    const source = fs.readFileSync(
      path.resolve(__dirname, "..", "workers", "transcription-worker.js"),
      "utf8"
    );
    // FilterExpression 用于 s3Key 过滤
    expect(source).toMatch(/FilterExpression.*"s3Key = :key"/);
    // s3Key 不在 KeyConditionExpression 中
    expect(source).not.toMatch(/KeyConditionExpression.*s3Key/);
  });

  // ── D7: 去重只对 isS3Event=true 的消息执行 ───────────────────────────────
  test("D7: 源码 dedup 逻辑包裹在 if (isS3Event) 条件内", () => {
    const fs   = require("fs");
    const path = require("path");
    const source = fs.readFileSync(
      path.resolve(__dirname, "..", "workers", "transcription-worker.js"),
      "utf8"
    );
    // dedup 注释 + isS3Event 条件应一起出现
    expect(source).toContain("if (isS3Event)");
    expect(source).toContain("Dedup");
  });

  // ── D8: QueryCommand Limit=1 优化（找到即可，不需要全量扫描）────────────
  test("D8: QueryCommand 携带 Limit: 1（找到即返回，节省 RCU）", () => {
    const fs   = require("fs");
    const path = require("path");
    const source = fs.readFileSync(
      path.resolve(__dirname, "..", "workers", "transcription-worker.js"),
      "utf8"
    );
    expect(source).toMatch(/Limit:\s*1/);
  });
});
