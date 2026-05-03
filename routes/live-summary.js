"use strict";

const { Router } = require("express");
const { z } = require("zod");

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

router.post("/", (req, res) => {
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

  const { sessionId, isFinal } = parsed.data;
  const gate = checkRateLimit(sessionId, isFinal);
  if (!gate.allowed) {
    return res.status(429).json({
      error: {
        code: "RATE_LIMITED",
        message: `Retry in ${Math.ceil(gate.retryInMs / 1000)}s`,
      },
    });
  }
  markCalled(sessionId);

  // TODO in later tasks: call generateLiveSummary
  return res.status(501).json({
    error: { code: "NOT_IMPLEMENTED", message: "live summary service not yet implemented" },
  });
});

module.exports = router;
