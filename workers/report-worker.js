require("dotenv").config();
const { receiveMessages, deleteMessage } = require("../services/sqs");
const { recordActivity } = require("../services/gpu-autoscale");
const { getFile, uploadFile } = require("../services/s3");
const { invokeModel } = require("../services/bedrock");
const { extractJsonFromLLMResponse } = require("../services/report-builder");
const { normalizeAnonymousSpeakerReport } = require("../services/report-speaker-normalizer");
const { applyGlossaryToReport } = require("../services/report-post-processor");
const glossaryStore = require("../services/glossary-store");
const logger = require("../services/logger");

/**
 * @typedef {Object} ReportMessage
 * @property {string} meetingId - crypto.randomUUID() 格式
 * @property {string} createdAt - ISO 8601 时间戳，必须与 DynamoDB 记录一致
 * @property {string} [meetingName] - 会议名称（用于邮件标题）
 */

const { docClient } = require("../db/dynamodb");
const { UpdateCommand, GetCommand } = require("@aws-sdk/lib-dynamodb");

const QUEUE_URL = process.env.SQS_REPORT_QUEUE;
const _EXPORT_QUEUE_URL = process.env.SQS_EXPORT_QUEUE;
const TABLE = process.env.DYNAMODB_TABLE;
const _GLOSSARY_TABLE = process.env.GLOSSARY_TABLE || "meeting-minutes-glossary";

// Glossary cache (TTL 10 min) — returns full items with .term, .aliases
let _glossaryCache = null;
let _glossaryCacheAt = 0;
const GLOSSARY_CACHE_TTL = 10 * 60 * 1000;

async function fetchGlossaryItems() {
  if (_glossaryCache && Date.now() - _glossaryCacheAt < GLOSSARY_CACHE_TTL) {
    return _glossaryCache;
  }
  try {
    const items = await glossaryStore.listGlossary();
    _glossaryCache = items;
    _glossaryCacheAt = Date.now();
    return items;
  } catch (err) {
    logger.warn("report-worker", "fetch-glossary-failed", { error: err.message });
    return [];
  }
}

const POLL_INTERVAL = 5000;

async function streamToString(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

function extractTranscribeText(rawJson) {
  try {
    const data = JSON.parse(rawJson);
    // AWS Transcribe JSON 格式：results.transcripts[0].transcript
    const transcript = data?.results?.transcripts?.[0]?.transcript;
    if (transcript) return transcript;
    // 如果解析不到，原样返回（可能已经是纯文本）
    return rawJson;
  } catch (_e) {
    // 不是 JSON，已经是纯文本
    return rawJson;
  }
}

async function readTranscript(transcribeKey, whisperKey) {
  const results = await Promise.allSettled([
    transcribeKey ? getFile(transcribeKey).then(s => streamToString(s)) : Promise.reject("no transcribeKey"),
    whisperKey ? getFile(whisperKey).then(s => streamToString(s)) : Promise.reject("no whisperKey"),
  ]);

  const rawTranscribeText = results[0].status === "fulfilled" ? results[0].value : null;
  const whisperText = results[1].status === "fulfilled" ? results[1].value : null;

  // AWS Transcribe 返回 JSON，需要提取纯文本
  const transcribeText = rawTranscribeText ? extractTranscribeText(rawTranscribeText) : null;

  if (!transcribeText && !whisperText) {
    throw new Error("Both transcription sources failed");
  }

  if (transcribeText && whisperText) {
    return `[AWS Transcribe 转录]\n${transcribeText}\n\n[Whisper 转录]\n${whisperText}`;
  }
  return transcribeText || whisperText;
}

async function readFunASRResult(funasrKey) {
  if (!funasrKey) return null;
  try {
    const stream = await getFile(funasrKey);
    const body = await streamToString(stream);
    const data = JSON.parse(body);
    // 格式化带说话人标签的文本
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
    logger.warn("report-worker", "funasr-read-failed", { error: err.message });
    return null;
  }
}

async function getMeetingType(meetingId, createdAt, messageType) {
  // Use meetingType from SQS message if provided
  if (messageType && messageType !== "general") {
    return messageType;
  }
  // Otherwise look up from DynamoDB
  try {
    const { Item } = await docClient.send(new GetCommand({
      TableName: TABLE,
      Key: { meetingId, createdAt },
    }));
    return Item?.meetingType || "general";
  } catch (err) {
    logger.warn("report-worker", "read-meetingType-failed", { meetingId, error: err.message });
    return "general";
  }
}

async function invokeModelWithRetry(transcriptText, meetingType, glossaryTerms, maxRetries = 3) {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const responseText = await invokeModel(transcriptText, meetingType, glossaryTerms);
      // Parse JSON response immediately (retry if parsing fails)
      const report = extractJsonFromLLMResponse(responseText);
      return report;
    } catch (err) {
      lastError = err;
      const errorName = err.name || "";
      const errorCode = err.Code || err.$metadata?.httpStatusCode || 0;
      const errorMessage = err.message || "";

      // Retryable errors: Throttling, ServiceUnavailable, JSON parse failures
      const isRetryable =
        errorName.includes("ThrottlingException") ||
        errorName.includes("ServiceUnavailableException") ||
        errorCode === 429 ||
        errorCode === 503 ||
        errorMessage.includes("Failed to parse Bedrock JSON response");

      if (!isRetryable || attempt === maxRetries) {
        logger.error("report-worker", "bedrock-invoke-failed", {
          attempt,
          errorName,
          errorCode,
          message: err.message,
        }, err);
        throw err;
      }

      // Backoff: 5s for all retries (JSON parse issues don't need exponential backoff)
      const delay = errorMessage.includes("Failed to parse Bedrock JSON response") ? 5000 : Math.min(5000 * Math.pow(3, attempt - 1), 300000);
      logger.warn("report-worker", "bedrock-retry", {
        attempt,
        nextAttempt: attempt + 1,
        delayMs: delay,
        errorName,
        isJsonParseError: errorMessage.includes("Failed to parse Bedrock JSON response"),
      });
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

async function processMessage(message) {
  const body = JSON.parse(message.Body);
  const { meetingId, transcribeKey, whisperKey, createdAt } = body;
  logger.info("report-worker", "generating-report", { meetingId });

  // Update stage to "generating"
  await docClient.send(new UpdateCommand({
    TableName: TABLE,
    Key: { meetingId, createdAt },
    UpdateExpression: "SET stage = :stage, updatedAt = :u",
    ExpressionAttributeValues: { ":stage": "generating", ":u": new Date().toISOString() },
  }));

  try {
    // Determine meeting type
    const meetingType = await getMeetingType(meetingId, createdAt, body.meetingType);
    logger.info("report-worker", "meeting-type-resolved", { meetingId, meetingType });

    // 1. Read transcript — try Transcribe/Whisper first, then FunASR
    let transcriptText = null;

    if (transcribeKey || whisperKey) {
      try {
        transcriptText = await readTranscript(transcribeKey, whisperKey);
      } catch (err) {
        logger.warn("report-worker", "transcribe-whisper-unavailable", { error: err.message });
      }
    }

    // 加入 FunASR 转录（含说话人标签）
    const funasrText = await readFunASRResult(body.funasrKey);

    // 至少需要一个转录来源
    if (!transcriptText && !funasrText) {
      throw new Error("All transcription sources failed (Transcribe, Whisper, FunASR)");
    }

    // 拼装最终转录内容
    const transcriptParts = [];
    if (transcriptText) {
      transcriptParts.push(transcriptText);
    }
    if (funasrText) {
      const truncated = funasrText.slice(0, 350000);  // Opus 4.6 1M context
      transcriptParts.push(`[FunASR 转录（含说话人标签）]\n${truncated}`);
    }
    const finalTranscript = transcriptParts.join("\n\n");

    // 2. Fetch glossary and call Bedrock Claude to generate structured report (with retry)
    const glossaryItems = await fetchGlossaryItems();
    const glossaryTerms = glossaryItems.map((i) => i.term).filter(Boolean);
    // invokeModelWithRetry now returns parsed report object (includes JSON parsing with retry)
    let report = await invokeModelWithRetry(finalTranscript, meetingType, glossaryTerms);
    report = normalizeAnonymousSpeakerReport(report);
    report = applyGlossaryToReport(report, glossaryItems);

    // 4. Upload report to S3
    const reportKey = `reports/${meetingId}/report.json`;
    await uploadFile(reportKey, JSON.stringify(report, null, 2), "application/json");

    // 5. Update DynamoDB status to "completed", stage to "done" (email sending is now manual)
    await docClient.send(new UpdateCommand({
      TableName: TABLE,
      Key: { meetingId, createdAt },
      UpdateExpression: "SET #s = :s, reportKey = :rk, content = :c, updatedAt = :u, stage = :stage",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: {
        ":s": "completed",
        ":rk": reportKey,
        ":c": report,
        ":u": new Date().toISOString(),
        ":stage": "done",
      },
    }));

    recordActivity();
    logger.info("report-worker", "report-generated", { meetingId });
  } catch (err) {
    logger.error("report-worker", "processing-failed", { meetingId }, err);

    // Retry count tracking — give up after 3 attempts to avoid infinite Bedrock API costs
    let retryCount = 0;
    try {
      const { Item } = await docClient.send(new GetCommand({
        TableName: TABLE,
        Key: { meetingId, createdAt },
      }));
      retryCount = Item?.retryCount || 0;
    } catch (getErr) {
      logger.warn("report-worker", "read-retryCount-failed", { meetingId, error: getErr.message });
    }

    if (retryCount >= 3) {
      logger.error("report-worker", "giving-up-after-retries", { meetingId, retries: retryCount });
      try {
        await docClient.send(new UpdateCommand({
          TableName: TABLE,
          Key: { meetingId, createdAt },
          UpdateExpression: "SET #s = :s, errorMessage = :em, stage = :stage, updatedAt = :u",
          ExpressionAttributeNames: { "#s": "status" },
          ExpressionAttributeValues: {
            ":s": "failed",
            ":em": `${err.message} (retried ${retryCount} times)`,
            ":stage": "failed",
            ":u": new Date().toISOString(),
          },
        }));
      } catch (updateErr) {
        logger.error("report-worker", "update-error-status-failed", { meetingId }, updateErr);
      }
      return; // Don't re-throw — let SQS message be deleted
    }

    try {
      await docClient.send(new UpdateCommand({
        TableName: TABLE,
        Key: { meetingId, createdAt },
        UpdateExpression: "SET #s = :s, errorMessage = :em, stage = :stage, retryCount = :rc, updatedAt = :u",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: {
          ":s": "failed",
          ":em": err.message,
          ":stage": "failed",
          ":rc": retryCount + 1,
          ":u": new Date().toISOString(),
        },
      }));
    } catch (updateErr) {
      logger.error("report-worker", "update-error-status-failed", { meetingId }, updateErr);
    }
    throw err; // Re-throw so message stays in SQS for retry
  }
}

async function poll() {
  logger.info("report-worker", "started");
  while (true) {
    try {
      const messages = await receiveMessages(QUEUE_URL);
      for (const msg of messages) {
        try {
          await processMessage(msg);
          await deleteMessage(QUEUE_URL, msg.ReceiptHandle);
        } catch (err) {
          logger.error("report-worker", "process-message-failed", {}, err);
          // 不删除消息 → SQS visibility timeout 后自动重试
        }
      }
    } catch (err) {
      logger.error("report-worker", "poll-error", {}, err);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
  }
}

poll();

process.on("unhandledRejection", (reason) => {
  logger.error("worker", "unhandled-rejection", {}, reason instanceof Error ? reason : new Error(String(reason)));
  process.exit(1);
});
process.on("uncaughtException", (err) => {
  logger.error("worker", "uncaught-exception", {}, err);
  process.exit(1);
});
