require("dotenv").config();
const { receiveMessages, deleteMessage } = require("../services/sqs");
const { getFile } = require("../services/s3");
const { ses } = require("../services/ses");
const logger = require("../services/logger");
const { docClient } = require("../db/dynamodb");
const { UpdateCommand, GetCommand } = require("@aws-sdk/lib-dynamodb");
const { SendEmailCommand } = require("@aws-sdk/client-ses");
const buildHtmlBody = require("./email-templates");

const QUEUE_URL = process.env.SQS_EXPORT_QUEUE;
const TABLE = process.env.DYNAMODB_TABLE;
const POLL_INTERVAL = 5000;

/* ─── helpers ─────────────────────────────────────────── */

async function streamToString(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

function nowISO() {
  return new Date().toISOString();
}

/* ─── SES email ───────────────────────────────────────── */

async function sendEmail({ to, subject, htmlBody }) {
  const toAddresses = Array.isArray(to) ? to : [to];
  const from = process.env.SES_FROM_EMAIL;

  await ses.send(new SendEmailCommand({
    Source: from,
    Destination: { ToAddresses: toAddresses },
    Message: {
      Subject: { Data: subject, Charset: "UTF-8" },
      Body: { Html: { Data: htmlBody, Charset: "UTF-8" } },
    },
  }));
}

/* ─── main processing ─────────────────────────────────── */

async function processMessage(message) {
  const body = JSON.parse(message.Body);
  const { meetingId, reportKey, createdAt } = body;
  logger.info("export-worker", "processing-start", { meetingId });

  // Update stage to "sending"
  await docClient.send(new UpdateCommand({
    TableName: TABLE,
    Key: { meetingId, createdAt },
    UpdateExpression: "SET stage = :stage, updatedAt = :u",
    ExpressionAttributeValues: { ":stage": "sending", ":u": nowISO() },
  }));

  try {
    // 1. Read report from S3
    const reportStream = await getFile(reportKey);
    const report = JSON.parse(await streamToString(reportStream));
    logger.info("export-worker", "report-loaded", { meetingId });

    // 2. Build HTML email and send via SES
    // Resolve recipient emails and title from DynamoDB
    const defaultTo = process.env.SES_TO_EMAIL;
    let recipientEmails = [];
    let dbTitle = null;
    try {
      const { Item } = await docClient.send(new GetCommand({
        TableName: TABLE,
        Key: { meetingId, createdAt },
        ProjectionExpression: "recipientEmails, title",
      }));
      if (Item && Item.recipientEmails && Item.recipientEmails.length) {
        recipientEmails = Item.recipientEmails;
      }
      if (Item && Item.title) dbTitle = Item.title;
    } catch (err) {
      logger.warn("export-worker", "read-dynamo-item-failed", { meetingId, error: err.message });
    }

    const meetingTitle = body.meetingName || dbTitle || report.title || report.meetingType || meetingId;
    const subject = `【会议纪要】${meetingTitle}`;
    const htmlBody = buildHtmlBody(report, meetingTitle);

    if (recipientEmails.length) {
      // Send to custom recipients, BCC default
      const toAddresses = recipientEmails;
      const from = process.env.SES_FROM_EMAIL;
      const bcc = defaultTo ? [defaultTo] : [];
      await ses.send(new SendEmailCommand({
        Source: from,
        Destination: { ToAddresses: toAddresses, BccAddresses: bcc },
        Message: {
          Subject: { Data: subject, Charset: "UTF-8" },
          Body: { Html: { Data: htmlBody, Charset: "UTF-8" } },
        },
      }));
      logger.info("export-worker", "email-sent", { to: toAddresses, bcc: defaultTo || "none" });
    } else if (defaultTo) {
      await sendEmail({ to: defaultTo, subject, htmlBody });
      logger.info("export-worker", "email-sent", { to: defaultTo });
    } else {
      logger.warn("export-worker", "no-recipients-skipping-email", { meetingId });
    }

    // 3. Update DynamoDB status to "completed", stage to "done"
    await docClient.send(new UpdateCommand({
      TableName: TABLE,
      Key: { meetingId, createdAt },
      UpdateExpression: "SET #s = :s, exportedAt = :ea, updatedAt = :u, stage = :stage",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: {
        ":s": "completed",
        ":ea": nowISO(),
        ":u": nowISO(),
        ":stage": "done",
      },
    }));
    logger.info("export-worker", "meeting-completed", { meetingId });
  } catch (err) {
    logger.error("export-worker", "processing-failed", { meetingId }, err);
    try {
      await docClient.send(new UpdateCommand({
        TableName: TABLE,
        Key: { meetingId, createdAt },
        UpdateExpression: "SET #s = :s, errorMessage = :em, stage = :stage, updatedAt = :u",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: {
          ":s": "failed",
          ":em": err.message,
          ":stage": "failed",
          ":u": nowISO(),
        },
      }));
    } catch (updateErr) {
      logger.error("export-worker", "update-error-status-failed", { meetingId }, updateErr);
    }
    throw err; // Re-throw so message is NOT deleted from SQS (visibility timeout retry)
  }
}

/* ─── polling loop ────────────────────────────────────── */

async function poll() {
  logger.info("export-worker", "started");
  while (true) {
    try {
      const messages = await receiveMessages(QUEUE_URL);
      for (const msg of messages) {
        try {
          await processMessage(msg);
          await deleteMessage(QUEUE_URL, msg.ReceiptHandle);
        } catch (err) {
          logger.error("export-worker", "process-message-failed", {}, err);
        }
      }
    } catch (err) {
      logger.error("export-worker", "poll-error", {}, err);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL));
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
