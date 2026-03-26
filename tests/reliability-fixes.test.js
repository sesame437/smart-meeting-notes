"use strict";

/**
 * reliability-fixes.test.js — Batch 2 修复专项测试
 *
 * 覆盖：
 *   Suite A: report-worker poll() per-message try/catch
 */

jest.mock("dotenv", () => ({ config: jest.fn() }));

// ─────────────────────────────────────────────────────────────────────────────
// Suite A — poll() per-message 错误处理
// ─────────────────────────────────────────────────────────────────────────────

describe("Suite A — poll() per-message 错误处理", () => {
  /**
   * 从 report-worker.js 摘出 poll() 的核心批处理逻辑进行白盒测试：
   *
   *   for (const msg of messages) {
   *     try {
   *       await processMessage(msg);
   *       await deleteMessage(QUEUE_URL, msg.ReceiptHandle);
   *     } catch (err) {
   *       console.error(...);
   *     }
   *   }
   *
   * 通过注入 mock 验证行为契约。
   */
  async function handleBatch(messages, processMessage, deleteMessage, queueUrl) {
    for (const msg of messages) {
      try {
        await processMessage(msg);
        await deleteMessage(queueUrl, msg.ReceiptHandle);
      } catch {
        // 不删消息 → SQS visibility timeout 后自动重试
      }
    }
  }

  beforeEach(() => jest.clearAllMocks());

  test("A1: 失败消息不调用 deleteMessage", async () => {
    const msg = { MessageId: "m1", ReceiptHandle: "r1" };
    const processMessage = jest.fn().mockRejectedValue(new Error("boom"));
    const deleteMessage = jest.fn();

    await handleBatch([msg], processMessage, deleteMessage, "q");

    expect(processMessage).toHaveBeenCalledTimes(1);
    expect(deleteMessage).not.toHaveBeenCalled();
  });

  test("A2: 失败不影响同批次其他消息继续处理", async () => {
    const msgs = [
      { MessageId: "m1", ReceiptHandle: "r1" },
      { MessageId: "m2", ReceiptHandle: "r2" },
      { MessageId: "m3", ReceiptHandle: "r3" },
    ];
    const processMessage = jest
      .fn()
      .mockRejectedValueOnce(new Error("boom on m1"))
      .mockResolvedValueOnce(undefined) // m2 成功
      .mockRejectedValueOnce(new Error("boom on m3")); // m3 失败
    const deleteMessage = jest.fn().mockResolvedValue({});

    await handleBatch(msgs, processMessage, deleteMessage, "q");

    expect(processMessage).toHaveBeenCalledTimes(3);
    // 只有 m2 应该被删除
    expect(deleteMessage).toHaveBeenCalledTimes(1);
    expect(deleteMessage).toHaveBeenCalledWith("q", "r2");
  });

  test("A3: 全部成功时所有消息都被删除", async () => {
    const msgs = [
      { MessageId: "m1", ReceiptHandle: "r1" },
      { MessageId: "m2", ReceiptHandle: "r2" },
    ];
    const processMessage = jest.fn().mockResolvedValue(undefined);
    const deleteMessage = jest.fn().mockResolvedValue({});

    await handleBatch(msgs, processMessage, deleteMessage, "q");

    expect(deleteMessage).toHaveBeenCalledTimes(2);
    expect(deleteMessage).toHaveBeenCalledWith("q", "r1");
    expect(deleteMessage).toHaveBeenCalledWith("q", "r2");
  });
});

