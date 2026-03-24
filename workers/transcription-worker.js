require("dotenv").config();
const { randomUUID } = require("crypto");
const {
  TranscribeClient,
  StartTranscriptionJobCommand,
  GetTranscriptionJobCommand,
  ListVocabulariesCommand,
} = require("@aws-sdk/client-transcribe");
const { S3Client, GetObjectCommand, PutObjectCommand } = require("@aws-sdk/client-s3");
const { UpdateCommand, PutCommand, GetCommand, QueryCommand } = require("@aws-sdk/lib-dynamodb");
const { docClient } = require("../db/dynamodb");
const { receiveMessages, deleteMessage, sendMessage } = require("../services/sqs");
const { ensureReady, recordActivity } = require("../services/gpu-autoscale");
const logger = require("../services/logger");

/**
 * @typedef {Object} TranscriptionMessage
 * @property {string} meetingId - crypto.randomUUID() 格式
 * @property {string} s3Key - 裸 key，不带 PREFIX，如 inbox/{meetingId}/{filename}
 * @property {string} createdAt - ISO 8601 时间戳
 * @property {string} meetingType - general|tech|weekly|merged
 * @property {boolean} isS3Event - 是否由 S3 Event 触发
 * @property {string} [filename] - 原始文件名
 * @property {string} [customPrompt] - 自定义 Prompt
 */

const QUEUE_URL = process.env.SQS_TRANSCRIPTION_QUEUE;
const REPORT_QUEUE_URL = process.env.SQS_REPORT_QUEUE;
const BUCKET = process.env.S3_BUCKET;
const PREFIX = process.env.S3_PREFIX || "meeting-minutes";
const REGION = process.env.AWS_REGION;
const DYNAMODB_TABLE = process.env.DYNAMODB_TABLE || "meeting-minutes-meetings";
const WHISPER_URL = process.env.WHISPER_URL || "http://localhost:9000";
const GLOSSARY_TABLE = process.env.GLOSSARY_TABLE || "meeting-minutes-glossary";
const FUNASR_URL = process.env.FUNASR_URL || "";  // 空字符串表示未配置
const ENABLE_TRANSCRIBE = process.env.ENABLE_TRANSCRIBE === "true";  // 默认关闭
const ENABLE_WHISPER = process.env.ENABLE_WHISPER === "true";        // 默认关闭
const ENABLE_FUNASR = FUNASR_URL ? true : false;                     // URL 存在则开启
const POLL_INTERVAL = 5000; // 5 seconds between SQS polls

const transcribeClient = new TranscribeClient({ region: REGION });
const s3 = new S3Client({ region: REGION });

// --------------- AWS Transcribe (Track 1) ---------------

async function checkVocabularyExists(vocabName) {
  try {
    const resp = await transcribeClient.send(new ListVocabulariesCommand({
      NameContains: vocabName,
    }));
    return (resp.Vocabularies || []).some((v) => v.VocabularyName === vocabName);
  } catch {
    return false;
  }
}

async function runAWSTranscribe(meetingId, s3Key) {
  const jobName = `${meetingId}-transcribe`;
  const outputKey = `transcripts/${meetingId}/transcribe.json`;
  const s3OutputKey = `${PREFIX}/${outputKey}`;
  const mediaUri = `s3://${BUCKET}/${s3Key}`;

  const params = {
    TranscriptionJobName: jobName,
    LanguageCode: "zh-CN",
    Media: { MediaFileUri: mediaUri },
    OutputBucketName: BUCKET,
    OutputKey: s3OutputKey,
  };

  // Use custom vocabulary if available
  const hasVocab = await checkVocabularyExists(GLOSSARY_TABLE);
  if (hasVocab) {
    params.Settings = { VocabularyName: GLOSSARY_TABLE };
    logger.info("transcription-worker", "using-custom-vocabulary", { vocabulary: GLOSSARY_TABLE });
  }

  logger.info("transcription-worker", "transcribe-job-starting", { jobName });
  await transcribeClient.send(new StartTranscriptionJobCommand(params));

  // Poll until complete (every 10s, max 30 minutes)
  const maxAttempts = 180; // 30 min / 10s
  for (let i = 0; i < maxAttempts; i++) {
    await sleep(10000);
    const resp = await transcribeClient.send(new GetTranscriptionJobCommand({
      TranscriptionJobName: jobName,
    }));
    const status = resp.TranscriptionJob.TranscriptionJobStatus;
    logger.info("transcription-worker", "transcribe-job-polling", { jobName, status, attempt: i + 1 });

    if (status === "COMPLETED") {
      return outputKey;
    }
    if (status === "FAILED") {
      const reason = resp.TranscriptionJob.FailureReason;
      throw new Error(`Transcribe job failed: ${reason}`);
    }
  }
  throw new Error(`Transcribe job timed out after 30 minutes`);
}

// --------------- Whisper HTTP API (Track 2) ---------------

async function isWhisperAvailable() {
  try {
    const resp = await fetch(`${WHISPER_URL}/health`, { signal: AbortSignal.timeout(5000) });
    return resp.ok;
  } catch {
    return false;
  }
}

async function runWhisper(meetingId, s3Key, _filename) {
  const outputKey = `transcripts/${meetingId}/whisper.json`;
  const s3OutputKey = `${PREFIX}/${outputKey}`;

  // Check Whisper service availability
  const available = await isWhisperAvailable();
  if (!available) {
    logger.warn("transcription-worker", "whisper-unavailable", { url: WHISPER_URL });
    return null;
  }

  // Pass s3_key directly — Whisper instance downloads from S3 itself
  // This avoids routing 617MB through the main EC2 and uses instance store cache
  logger.info("transcription-worker", "whisper-sending-s3-key", { url: `${WHISPER_URL}/asr` });
  const formData = new FormData();
  formData.append("s3_key", s3Key);
  formData.append("s3_bucket", BUCKET);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30 * 60 * 1000); // 30 min
  let resp;
  try {
    resp = await fetch(`${WHISPER_URL}/asr`, {
      method: "POST",
      body: formData,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!resp.ok) {
    throw new Error(`Whisper API returned ${resp.status}: ${await resp.text()}`);
  }

  const result = await resp.json();
  logger.info("transcription-worker", "whisper-done", { language: result.language });

  // Upload result to S3
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: s3OutputKey,
    Body: JSON.stringify(result, null, 2),
    ContentType: "application/json",
  }));

  return outputKey;
}

// --------------- FunASR (Track 3) ---------------
async function runFunASR(meetingId, s3Key) {
  if (!FUNASR_URL) {
    logger.info("transcription-worker", "funasr-not-configured");
    return null;
  }

  const outputKey = `transcripts/${meetingId}/funasr.json`;
  const s3OutputKey = `${PREFIX}/${outputKey}`;

  try {
    logger.info("transcription-worker", "funasr-sending-s3-key", { url: `${FUNASR_URL}/asr` });
    // s3Key stored in DB may not have prefix; FunASR needs the full key with prefix
    const fullS3Key = s3Key.startsWith(PREFIX) ? s3Key : `${PREFIX}/${s3Key}`;
    const formData = new FormData();
    formData.append("s3_key", fullS3Key);
    formData.append("s3_bucket", process.env.S3_BUCKET || "yc-projects-012289836917");
    formData.append("language", "zh");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30 * 60 * 1000); // 30 分钟

    let resp;
    try {
      resp = await fetch(`${FUNASR_URL}/asr`, {
        method: "POST",
        body: formData,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`FunASR /asr returned ${resp.status}: ${errText.slice(0, 200)}`);
    }

    const result = await resp.json();
    if (result.error) throw new Error(`FunASR error: ${result.error}`);

    // 上传结果到 S3
    const s3Body = JSON.stringify(result);
    await s3.send(new PutObjectCommand({
      Bucket: process.env.S3_BUCKET || "yc-projects-012289836917",
      Key: s3OutputKey,
      Body: s3Body,
      ContentType: "application/json",
    }));

    logger.info("transcription-worker", "funasr-done", { segments: result.segments?.length || 0, speakers: result.speaker_count || 0, outputKey });
    return outputKey;
  } catch (err) {
    if (err.name === "AbortError") {
      logger.error("transcription-worker", "funasr-timeout", { timeoutMinutes: 30 });
      throw new Error(`FunASR timeout after 30 minutes`, { cause: err });
    } else {
      logger.error("transcription-worker", "funasr-failed", {}, err);
      throw err; // Propagate error for retry logic
    }
  }
}

// --------------- DynamoDB Update ---------------

async function updateMeetingStatus(meetingId, createdAt, status, extraAttrs = {}) {
  const names = { "#s": "status", "#u": "updatedAt" };
  const values = { ":s": status, ":u": new Date().toISOString() };
  let expr = "SET #s = :s, #u = :u";

  for (const [k, v] of Object.entries(extraAttrs)) {
    const nameKey = `#${k}`;
    const valKey = `:${k}`;
    names[nameKey] = k;
    values[valKey] = v;
    expr += `, ${nameKey} = ${valKey}`;
  }

  await docClient.send(new UpdateCommand({
    TableName: DYNAMODB_TABLE,
    Key: { meetingId, createdAt },
    UpdateExpression: expr,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
  }));
}

// --------------- Message Parsing ---------------

function parseMeetingTypeFromFilename(filename) {
  if (filename.startsWith("weekly__")) return "weekly";
  if (filename.startsWith("tech__")) return "tech";
  return "general";
}

function parseMessage(body) {
  // S3 Event Notification format
  if (body.Records && body.Records[0] && body.Records[0].s3) {
    const s3Event = body.Records[0].s3;
    const s3Key = decodeURIComponent(s3Event.object.key.replace(/\+/g, " "));
    const filename = s3Key.split("/").pop();
    const meetingId = randomUUID();
    const meetingType = parseMeetingTypeFromFilename(filename);
    // Strip PREFIX from s3Key for consistent storage (S3 events include full key with prefix)
    const PREFIX_PATH = (process.env.S3_PREFIX || "meeting-minutes") + "/";
    const bareS3Key = s3Key.startsWith(PREFIX_PATH) ? s3Key.slice(PREFIX_PATH.length) : s3Key;
    return { meetingId, s3Key: bareS3Key, filename, meetingType, isS3Event: true };
  }

  // Internal format
  return {
    meetingId: body.meetingId,
    s3Key: body.s3Key,
    filename: body.filename,
    meetingType: body.meetingType || "general",
    isS3Event: false,
  };
}

// --------------- Message Processing ---------------

async function processMessage(message) {
  const body = JSON.parse(message.Body);
  const { meetingId, s3Key, filename, meetingType, isS3Event } = parseMessage(body);

  // Skip invalid or empty messages
  if (!s3Key) {
    logger.info("transcription-worker", "skip-no-s3Key", { body: JSON.stringify(body).slice(0, 200) });
    return;
  }

  // Skip .keep files
  if (s3Key.endsWith(".keep")) {
    logger.info("transcription-worker", "skip-keep-file", { s3Key });
    return;
  }

  // Dedup: check if this s3Key is already being processed (S3 events only)
  // Uses GSI (status-createdAt-index) Query + filter instead of full table Scan
  if (isS3Event) {
    const statusesToCheck = ["uploaded", "pending", "processing", "transcribed", "reported", "completed", "failed"];
    let found = false;
    let foundMeetingId = null;

    for (const st of statusesToCheck) {
      const result = await docClient.send(new QueryCommand({
        TableName: DYNAMODB_TABLE,
        IndexName: "status-createdAt-index",
        KeyConditionExpression: "#s = :s",
        FilterExpression: "s3Key = :key",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: { ":s": st, ":key": s3Key },
        Limit: 1,
      }));
      if (result.Items && result.Items.length > 0) {
        found = true;
        foundMeetingId = result.Items[0].meetingId;
        break;
      }
    }

    if (found) {
      logger.info("transcription-worker", "dedup-skip", { s3Key, existingMeetingId: foundMeetingId });
      return;
    }
  }

  // Auto-create DynamoDB record for S3 Event messages
  // For retry messages, createdAt comes from SQS body (existing record)
  const createdAt = body.createdAt || new Date().toISOString();
  if (isS3Event) {
    logger.info("transcription-worker", "s3-event-creating-record", { meetingId, meetingType });
    await docClient.send(new PutCommand({
      TableName: DYNAMODB_TABLE,
      Item: {
        meetingId,
        status: "processing",
        filename,
        s3Key,
        meetingType,
        createdAt,
      },
    }));
  }

  // Update stage to "transcribing"
  await updateMeetingStatus(meetingId, createdAt, "processing", { stage: "transcribing" });

  try {
    logger.info("transcription-worker", "processing-start", { meetingId, s3Key });
    logger.info("transcription-worker", "pipeline-tracks", { transcribe: ENABLE_TRANSCRIBE, whisper: ENABLE_WHISPER, funasr: ENABLE_FUNASR });

    // GPU auto-scale: ensure FunASR instance is running before transcription
    if (ENABLE_FUNASR) {
      const ready = await ensureReady();
      if (!ready) {
        // FunASR not ready after timeout - check retry count
        let retryCount = 0;
        try {
          const { Item } = await docClient.send(new GetCommand({
            TableName: DYNAMODB_TABLE,
            Key: { meetingId, createdAt },
          }));
          retryCount = Item?.retryCount || 0;
        } catch (err) {
          logger.warn("transcription-worker", "read-retryCount-failed", { meetingId, error: err.message });
        }

        if (retryCount >= 3) {
          throw new Error("FunASR not ready after 3 retries, giving up");
        }

        // Increment retry count and reset to pending for next attempt
        logger.info("transcription-worker", "funasr-not-ready-retry", { meetingId, retryCount: retryCount + 1 });
        await updateMeetingStatus(meetingId, createdAt, "pending", {
          retryCount: retryCount + 1,
          stage: "waiting-gpu",
        });
        // Throw to prevent message deletion, allowing SQS visibility timeout retry
        throw new Error(`FunASR not ready, retry ${retryCount + 1}/3`);
      }
    }
    recordActivity();

    // Run enabled tracks in parallel
    // Note: FunASR errors propagate for retry logic; other tracks fail gracefully
    const [transcribeKey, whisperKey, funasrKey] = await Promise.all([
      ENABLE_TRANSCRIBE
        ? runAWSTranscribe(meetingId, s3Key).catch((err) => { logger.error("transcription-worker", "transcribe-track-failed", {}, err); return null; })
        : Promise.resolve(null),
      ENABLE_WHISPER
        ? runWhisper(meetingId, s3Key, filename).catch((err) => { logger.error("transcription-worker", "whisper-track-failed", {}, err); return null; })
        : Promise.resolve(null),
      ENABLE_FUNASR
        ? runFunASR(meetingId, s3Key) // Let errors propagate for unified retry logic
        : Promise.resolve(null),
    ]);

    if (!transcribeKey && !whisperKey && !funasrKey) {
      throw new Error("All transcription tracks failed");
    }

    logger.info("transcription-worker", "transcription-result", { transcribeKey: transcribeKey || "FAILED", whisperKey: whisperKey || "SKIPPED", funasrKey: funasrKey || "SKIPPED" });

    // Extract unique speakers from FunASR result
    let speakers = [];
    if (funasrKey) {
      try {
        const fullFunasrKey = funasrKey.startsWith(PREFIX) ? funasrKey : `${PREFIX}/${funasrKey}`;
        const resp = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: fullFunasrKey }));
        const chunks = [];
        for await (const chunk of resp.Body) chunks.push(chunk);
        const funasrResult = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
        if (funasrResult.segments && funasrResult.segments.length > 0) {
          const speakerSet = new Set();
          for (const seg of funasrResult.segments) {
            if (seg.speaker) speakerSet.add(seg.speaker);
          }
          speakers = Array.from(speakerSet).sort();
        }
      } catch (err) {
        logger.warn("transcription-worker", "extract-speakers-failed", { error: err.message });
      }
    }

    // Update DynamoDB meeting status, advance stage to "reporting"
    const extraAttrs = {
      transcribeKey: transcribeKey || "",
      whisperKey: whisperKey || "",
      funasrKey: funasrKey || "",
      stage: "reporting",
    };
    if (speakers.length > 0) {
      extraAttrs.speakers = speakers;
    }
    await updateMeetingStatus(meetingId, createdAt, "transcribed", extraAttrs);

    // Resolve meetingType: use parsed value, or look up from DynamoDB
    let resolvedMeetingType = meetingType;
    if (!resolvedMeetingType || resolvedMeetingType === "general") {
      try {
        const { Item } = await docClient.send(new GetCommand({
          TableName: DYNAMODB_TABLE,
          Key: { meetingId, createdAt },
        }));
        if (Item && Item.meetingType) {
          resolvedMeetingType = Item.meetingType;
        }
      } catch (err) {
        logger.warn("transcription-worker", "read-meetingType-failed", { meetingId, error: err.message });
      }
    }

    // Send message to report queue
    await sendMessage(REPORT_QUEUE_URL, {
      meetingId,
      transcribeKey: transcribeKey || null,
      whisperKey: whisperKey || null,
      funasrKey: funasrKey || null,
      meetingType: resolvedMeetingType || "general",
      createdAt,
    });

    recordActivity();
    logger.info("transcription-worker", "transcription-complete", { meetingId });
  } catch (err) {
    logger.error("transcription-worker", "processing-failed", { meetingId }, err);

    // Unified retry logic for all failure scenarios
    let retryCount = 0;
    try {
      const { Item } = await docClient.send(new GetCommand({
        TableName: DYNAMODB_TABLE,
        Key: { meetingId, createdAt },
      }));
      retryCount = Item?.retryCount || 0;
    } catch (getErr) {
      logger.warn("transcription-worker", "read-retryCount-failed", { meetingId, error: getErr.message });
    }

    if (retryCount < 3) {
      // Retry: update status to pending and increment retry count
      logger.info("transcription-worker", "error-retry", { meetingId, retryCount: retryCount + 1, errorType: err.name || "Error" });
      try {
        await updateMeetingStatus(meetingId, createdAt, "pending", {
          retryCount: retryCount + 1,
          stage: "waiting-retry",
          errorMessage: err.message, // Keep error message for debugging
        });
      } catch (updateErr) {
        logger.error("transcription-worker", "update-retry-status-failed", { meetingId }, updateErr);
      }
      throw err; // Re-throw to prevent SQS message deletion (visibility timeout retry)
    }

    // Exceeded retry limit: mark as failed
    logger.error("transcription-worker", "giving-up-after-retries", { meetingId, retries: retryCount });
    try {
      await updateMeetingStatus(meetingId, createdAt, "failed", {
        errorMessage: `${err.message} (retried ${retryCount} times)`,
        stage: "failed",
      });
    } catch (updateErr) {
      logger.error("transcription-worker", "update-error-status-failed", { meetingId }, updateErr);
    }
    // Don't re-throw — let SQS message be deleted after final failure
  }
}

// --------------- Polling Loop ---------------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function poll() {
  logger.info("transcription-worker", "started");
  while (true) {
    try {
      const messages = await receiveMessages(QUEUE_URL);
      if (messages.length > 0) {
        for (const msg of messages) {
          try {
            await processMessage(msg);
            await deleteMessage(QUEUE_URL, msg.ReceiptHandle);
          } catch (err) {
            logger.error("transcription-worker", "process-message-failed", {}, err);
          }
        }
      }
    } catch (err) {
      logger.error("transcription-worker", "poll-error", {}, err);
    }
    await sleep(POLL_INTERVAL);
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
