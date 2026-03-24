const logger = require("../services/logger");

/**
 * API Key 认证中间件
 *
 * 从环境变量 API_KEY 读取密钥。若未设置，则跳过认证（方便本地开发）。
 * 支持两种认证方式：
 * 1. Authorization: Bearer <API_KEY>
 * 2. x-api-key: <API_KEY>
 */
function authenticateAPIKey(req, res, next) {
  const configuredKey = process.env.API_KEY;

  // 若未配置 API_KEY，跳过认证
  if (!configuredKey) {
    return next();
  }

  // 从 header 提取 API Key
  const authHeader = req.headers.authorization;
  const apiKeyHeader = req.headers["x-api-key"];

  let providedKey = null;

  if (authHeader && authHeader.startsWith("Bearer ")) {
    providedKey = authHeader.substring(7);
  } else if (apiKeyHeader) {
    providedKey = apiKeyHeader;
  }

  if (!providedKey) {
    logger.warn("auth", "missing-credentials", {
      ip: req.ip,
      path: req.path,
      method: req.method
    });
    return res.status(401).json({
      error: {
        code: "UNAUTHORIZED",
        message: "Missing API key. Provide Authorization: Bearer <key> or x-api-key header"
      }
    });
  }

  if (providedKey !== configuredKey) {
    logger.warn("auth", "invalid-credentials", {
      ip: req.ip,
      path: req.path,
      method: req.method
    });
    return res.status(401).json({
      error: {
        code: "UNAUTHORIZED",
        message: "Invalid API key"
      }
    });
  }

  // 认证通过
  next();
}

module.exports = authenticateAPIKey;
