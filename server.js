require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const path = require("path");

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

app.listen(PORT, () => {
  console.log(`meeting-minutes server listening on port ${PORT}`);
});
