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
  // TODO in later tasks: rate limit, call service
  return res.status(501).json({
    error: { code: "NOT_IMPLEMENTED", message: "live summary service not yet implemented" },
  });
});

module.exports = router;
