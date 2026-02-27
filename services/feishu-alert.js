const https = require("https");
const logger = require("./logger");

const FEISHU_BOT_TOKEN = process.env.FEISHU_BOT_TOKEN;
const FEISHU_ALERT_USER = process.env.FEISHU_ALERT_USER; // open_id

/**
 * Send a Feishu alert message. Silently skips if env vars are not configured.
 * @param {string} workerName - e.g. "transcription-worker" or "report-worker"
 * @param {string} meetingId
 * @param {string} errorMsg
 */
function sendFeishuAlert(workerName, meetingId, errorMsg) {
  if (!FEISHU_BOT_TOKEN || !FEISHU_ALERT_USER) {
    return;
  }

  const text = `⚠️ Worker 失败：[${workerName}] meetingId=${meetingId} error=${errorMsg}`;
  const payload = JSON.stringify({
    receive_id: FEISHU_ALERT_USER,
    msg_type: "text",
    content: JSON.stringify({ text }),
  });

  const req = https.request(
    {
      hostname: "open.feishu.cn",
      path: "/open-apis/im/v1/messages?receive_id_type=open_id",
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Authorization: `Bearer ${FEISHU_BOT_TOKEN}`,
        "Content-Length": Buffer.byteLength(payload),
      },
    },
    (res) => {
      // Consume response to free socket
      res.resume();
      if (res.statusCode !== 200) {
        logger.warn("feishu-alert", "send-failed", { statusCode: res.statusCode });
      }
    },
  );

  req.on("error", (err) => {
    logger.warn("feishu-alert", "request-error", { error: err.message });
  });

  req.write(payload);
  req.end();
}

module.exports = { sendFeishuAlert };
