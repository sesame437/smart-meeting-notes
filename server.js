require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const path = require("path");

// 启动时校验必需环境变量
const REQUIRED_ENV = [
  "S3_BUCKET", "S3_PREFIX", "DYNAMODB_TABLE",
  "SQS_TRANSCRIPTION_QUEUE", "AWS_REGION", "BEDROCK_MODEL_ID"
];
const missingEnv = REQUIRED_ENV.filter(k => !process.env[k]);
if (missingEnv.length > 0) {
  console.error("❌ 缺少必需环境变量:", missingEnv.join(", "));
  process.exit(1);
}

const meetingsRouter = require("./routes/meetings");
const glossaryRouter = require("./routes/glossary");

const app = express();
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
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "meeting-minutes" });
});

app.use("/api/meetings", meetingsRouter);
app.use("/api/glossary", glossaryRouter);

// Unified error handling middleware (must be after all routes)
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  console.error("[error]", req.method, req.path, err.message);
  res.status(status).json({ error: err.message || "Internal server error" });
});

const server = app.listen(PORT, () => {
  console.log(`meeting-minutes server listening on port ${PORT}`);
});

// 优雅关机：等待 in-flight 请求完成后退出
function gracefulShutdown(signal) {
  console.log(`[server] Received ${signal}, shutting down gracefully...`);
  server.close(() => {
    console.log("[server] HTTP server closed");
    process.exit(0);
  });
  // 10 秒超时强制退出
  setTimeout(() => {
    console.error("[server] Forced shutdown after timeout");
    process.exit(1);
  }, 10000);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
