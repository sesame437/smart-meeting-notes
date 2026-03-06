require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const path = require("path");

const rateLimit = require("express-rate-limit");
const logger = require("./services/logger");
const authenticateAPIKey = require("./middleware/auth");

// 启动时校验必需环境变量
const REQUIRED_ENV = [
  "S3_BUCKET", "S3_PREFIX", "DYNAMODB_TABLE",
  "SQS_TRANSCRIPTION_QUEUE", "AWS_REGION", "BEDROCK_MODEL_ID"
];
const missingEnv = REQUIRED_ENV.filter(k => !process.env[k]);
if (missingEnv.length > 0) {
  logger.error("server", "missing-env-vars", { missing: missingEnv });
  process.exit(1);
}
const meetingsRouter = require("./routes/meetings/index");
const glossaryRouter = require("./routes/glossary");

const app = express();
app.set("trust proxy", 1);
const PORT = process.env.PORT || 3300;

app.use(cors({ origin: ["http://localhost:3300", "http://172.31.21.140:3300"] }));
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],          // 禁止内联 script（强制 CSP 合规）
      styleSrc: ["'self'", "'unsafe-inline'"],   // 允许 inline style（表单控件需要）
      fontSrc: ["'self'", "data:"],   // 本地字体 + data URI
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'"],         // 只允许同源 API 请求
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
}));
app.use(express.json());
// Serve static files from public/ directory (legacy HTML+CSS frontend)
app.use(express.static(path.join(__dirname, "public"), { maxAge: 0, etag: false, lastModified: false }));

// Rate limiting for upload and report generation endpoints
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // limit each IP to 10 requests per minute
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      error: {
        code: "RATE_LIMIT_EXCEEDED",
        message: "Too many requests, please try again later"
      }
    });
  },
});
app.use("/api/meetings/upload", apiLimiter);
app.use("/api/meetings/upload-multiple", apiLimiter);
app.use("/api/meetings/:id/regenerate", apiLimiter);
app.use("/api/meetings/:id/report", apiLimiter);
app.use("/api/meetings/:id/speaker-names", apiLimiter);
app.use("/api/meetings/:id/speaker-map", apiLimiter);
app.use("/api/meetings/:id/auto-name", apiLimiter);
app.use("/api/meetings/merge", apiLimiter);

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "meeting-minutes" });
});

// Apply API Key authentication to all /api routes except /api/health
app.use("/api/meetings", authenticateAPIKey, meetingsRouter);
app.use("/api/glossary", authenticateAPIKey, glossaryRouter);

// SPA fallback — serve index.html for all non-API routes
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, 'public/index.html'));
  }
});

// Unified error handling middleware (must be after all routes)
app.use((err, req, res, _next) => {
  const status = err.status || err.statusCode || 500;
  logger.error("server", "unhandled-error", { method: req.method, path: req.path }, err);
  res.status(status).json({ error: { code: "INTERNAL_ERROR", message: err.message || "Internal server error" } });
});

const server = app.listen(PORT, () => {
  logger.info("server", "listening", { port: PORT });
});

// 优雅关机：等待 in-flight 请求完成后退出
function gracefulShutdown(signal) {
  logger.info("server", "shutdown-started", { signal });
  server.close(() => {
    logger.info("server", "shutdown-complete", {});
    process.exit(0);
  });
  // 10 秒超时强制退出
  setTimeout(() => {
    logger.error("server", "shutdown-timeout", {});
    process.exit(1);
  }, 10000);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

process.on("unhandledRejection", (reason) => {
  logger.error("server", "unhandled-rejection", {}, reason instanceof Error ? reason : new Error(String(reason)));
  process.exit(1);
});
process.on("uncaughtException", (err) => {
  logger.error("server", "uncaught-exception", {}, err);
  process.exit(1);
});
