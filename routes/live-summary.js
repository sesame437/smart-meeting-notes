"use strict";

const { Router } = require("express");
const { z } = require("zod");
const { generateLiveSummary } = require("../services/bedrock-live");
const logger = require("../services/logger");

const router = Router();

const liveSummarySchema = z.object({
  sessionId: z.string().uuid(),
  transcriptText: z.string().min(1).max(200_000),
  elapsedSec: z.number().int().positive(),
  meetingType: z.enum(["general", "weekly", "tech", "customer", "interview"]).optional(),
  isFinal: z.boolean().default(false),
});

// In-memory per-session last-call timestamp. Single-node server; no persistence required.
const MIN_INTERVAL_MS = 60_000;
const lastCallBySession = new Map();

function checkRateLimit(sessionId, isFinal) {
  if (isFinal) return { allowed: true };
  const last = lastCallBySession.get(sessionId);
  const now = Date.now();
  if (last && now - last < MIN_INTERVAL_MS) {
    return { allowed: false, retryInMs: MIN_INTERVAL_MS - (now - last) };
  }
  return { allowed: true };
}

function markCalled(sessionId) {
  lastCallBySession.set(sessionId, Date.now());
  // Opportunistic cleanup: drop entries older than 1 hour.
  const cutoff = Date.now() - 3_600_000;
  for (const [k, v] of lastCallBySession) {
    if (v < cutoff) lastCallBySession.delete(k);
  }
}

const CODE_TO_STATUS = {
  BEDROCK_TIMEOUT: 504,
  BEDROCK_UNAVAILABLE: 503,
  INTERNAL: 500,
};

router.post("/", async (req, res) => {
  const parsed = liveSummarySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
        fields: parsed.error.issues.map((i) => ({
          field: i.path.join("."),
          message: i.message,
        })),
      },
    });
  }

  const { sessionId, transcriptText, elapsedSec, meetingType, isFinal } = parsed.data;
  const gate = checkRateLimit(sessionId, isFinal);
  if (!gate.allowed) {
    return res.status(429).json({
      error: { code: "RATE_LIMITED", message: `Retry in ${Math.ceil(gate.retryInMs / 1000)}s` },
    });
  }

  const startedAt = Date.now();
  try {
    const summary = await generateLiveSummary(transcriptText, { meetingType, elapsedSec });
    // Only stamp the rate-limit slot on success; Bedrock failures should not
    // count against the client, per spec §Degradation: "503 → client backs off 60s then retries".
    markCalled(sessionId);
    logger.info("live-summary", "complete", {
      module: "live-summary",
      sessionId,
      elapsedSec,
      tokensInput: summary.tokensInput,
      tokensOutput: summary.tokensOutput,
      latencyMs: Date.now() - startedAt,
      isFinal,
    });
    return res.status(200).json(summary);
  } catch (err) {
    const code = err.code || "INTERNAL";
    const status = CODE_TO_STATUS[code] || 500;
    logger.error("live-summary", "failed", {
      module: "live-summary",
      sessionId,
      code,
      latencyMs: Date.now() - startedAt,
    }, err);
    // INTERNAL errors may carry stack / path fragments in their message. Sanitize
    // outbound message for unclassified errors; classified codes (BEDROCK_*) are safe.
    const outboundMessage = code === "INTERNAL" ? "live summary failed" : (err.message || "live summary failed");
    return res.status(status).json({
      error: { code, message: outboundMessage },
    });
  }
});

module.exports = router;
