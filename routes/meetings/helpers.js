const path = require("path");
const multer = require("multer");
const { getFile } = require("../../services/s3");
const logger = require("../../services/logger");
const store = require("../../services/meeting-store");

const TABLE = process.env.DYNAMODB_TABLE;
const GLOSSARY_TABLE = process.env.GLOSSARY_TABLE || "meeting-minutes-glossary";
const HAIKU_MODEL_ID = process.env.HAIKU_MODEL_ID || "us.anthropic.claude-haiku-4-5-20251001-v1:0";

// Param validation middleware: id must be non-empty, max 100 chars
function validateIdParam(req, res, next) {
  const id = req.params.id;
  if (!id || typeof id !== "string" || id.length > 100) {
    return res.status(400).json({ error: { code: "INVALID_ID", message: "Invalid id parameter" } });
  }
  next();
}

const upload = multer({
  dest: "/tmp",
  limits: {
    fileSize: 2 * 1024 * 1024 * 1024, // 2GB
    files: 10, // 支持最多 10 个文件
  },
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      "audio/mpeg", "audio/wav", "audio/mp4", "audio/x-m4a",
      "audio/ogg", "audio/x-ogg", "video/ogg", "application/x-ogg", "audio/vorbis",
      "audio/webm", "video/mp4", "video/webm",
      "video/quicktime", "application/octet-stream",
    ];
    const allowedExts = [".mp3", ".wav", ".mp4", ".m4a", ".ogg", ".webm", ".mov"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedMimes.includes(file.mimetype) || allowedExts.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`不支持的文件格式: ${file.originalname}`), false);
    }
  },
});

// eslint-disable-next-line no-control-regex
const DANGEROUS_CHARS = /[<>:"/\\|?*\x00-\x1f]/g;

function sanitizeFilename(name) {
  return name
    .replace(DANGEROUS_CHARS, "_")
    .replace(/\.{2,}/g, "_")
    .substring(0, 200);
}

async function getMeetingById(id) {
  return await store.queryMeetingById(id);
}

function validateSpeakerMap(speakerMap) {
  if (!speakerMap || typeof speakerMap !== "object" || Array.isArray(speakerMap)) {
    return "speakerMap must be an object";
  }
  if (Object.keys(speakerMap).length === 0) {
    return "speakerMap cannot be empty";
  }
  for (const [speakerId, speakerName] of Object.entries(speakerMap)) {
    if (!speakerId || typeof speakerId !== "string" || speakerId.length > 200) {
      return "speakerMap key must be a non-empty string";
    }
    if (typeof speakerName !== "string") {
      return "speakerMap values must be strings";
    }
    if (speakerName.length > 100) {
      return "speakerMap value must be at most 100 characters";
    }
  }
  return null;
}

async function readTranscriptParts(item) {
  const transcriptParts = [];

  if (item.funasrKey) {
    try {
      const stream = await getFile(item.funasrKey);
      const chunks = [];
      for await (const chunk of stream) {
        chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
      }
      const raw = Buffer.concat(chunks).toString("utf-8");
      const data = JSON.parse(raw);
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
        const funasrText = lines.join("\n").slice(0, 350000);
        transcriptParts.push(`[FunASR 转录（含说话人标签）]\n${funasrText}`);
      } else if (data.text) {
        transcriptParts.push(`[FunASR 转录（含说话人标签）]\n${data.text}`);
      }
    } catch (err) {
      logger.warn("meetings-route", "read-funasrKey-failed", { error: err.message });
    }
  }

  return transcriptParts;
}

module.exports = {
  TABLE,
  GLOSSARY_TABLE,
  HAIKU_MODEL_ID,
  validateIdParam,
  upload,
  // uploadMultiple 用于多文件上传路由（动态生成）
  get uploadMultiple() {
    return upload.array("files", 10);
  },
  sanitizeFilename,
  getMeetingById,
  validateSpeakerMap,
  readTranscriptParts,
};
