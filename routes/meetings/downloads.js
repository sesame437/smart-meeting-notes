const { getFile, uploadFile, getPresignedDownloadUrl } = require("../../services/s3");
const logger = require("../../services/logger");
const { buildPlainTranscript } = require("../../services/funasr-transcript");
const { getMeetingById } = require("./helpers");

const PRESIGN_EXPIRES_IN = 900;

async function streamToString(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

function register(router) {
  router.get("/:id/transcript-url", async (req, res, next) => {
    const meetingId = req.params.id;
    try {
      const item = await getMeetingById(meetingId);
      if (!item) {
        return res.status(404).json({
          error: { code: "MEETING_NOT_FOUND", message: "Meeting not found" },
        });
      }
      if (!item.funasrKey) {
        return res.status(400).json({
          error: { code: "FUNASR_NOT_READY", message: "FunASR transcript not generated yet" },
        });
      }

      let funasrJson;
      try {
        const stream = await getFile(item.funasrKey);
        const raw = await streamToString(stream);
        funasrJson = JSON.parse(raw);
      } catch (err) {
        logger.error("downloads-route", "funasr-read-failed", { meetingId }, err);
        return res.status(500).json({
          error: { code: "S3_GET_FAILED", message: "Failed to read FunASR result" },
        });
      }

      const text = buildPlainTranscript(funasrJson, item.speakerMap || {});
      const transcriptKey = `transcripts/${meetingId}/transcript.txt`;

      try {
        await uploadFile(transcriptKey, text, "text/plain; charset=utf-8");
      } catch (err) {
        logger.error("downloads-route", "transcript-upload-failed", { meetingId }, err);
        return res.status(500).json({
          error: { code: "S3_UPLOAD_FAILED", message: "Failed to upload transcript" },
        });
      }

      let url;
      try {
        url = await getPresignedDownloadUrl(transcriptKey, { expiresIn: PRESIGN_EXPIRES_IN });
      } catch (err) {
        logger.error("downloads-route", "presign-failed", { meetingId }, err);
        return res.status(500).json({
          error: { code: "S3_PRESIGN_FAILED", message: "Failed to sign URL" },
        });
      }

      logger.info("downloads-route", "transcript-url-generated", { meetingId });
      res.json({ url, expiresIn: PRESIGN_EXPIRES_IN });
    } catch (err) {
      next(err);
    }
  });
}

module.exports = register;
