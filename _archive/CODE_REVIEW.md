# Code Review Report — Smart Meeting Notes

**日期**: 2026-03-24  
**审查范围**: 全部后端核心代码（services/, routes/, workers/, middleware/, server.js）  
**审查人**: Kiro AI

---

## 🔴 Critical（严重问题）

### CR-01: `.env` 文件包含真实 AWS 账号 ID 和内网 IP，已提交到仓库历史

- **文件**: `.env`（第 2-8 行）
- **问题**: `.env` 虽在 `.gitignore` 中，但 `.env.example` 包含真实 AWS 账号 ID `012289836917` 和 SQS 队列 URL。如果仓库曾经公开或 `.env` 曾被误提交，这些信息会泄露。
- **建议**: 将 `.env.example` 中的 AWS 账号 ID 替换为占位符 `123456789012`，SQS URL 使用 `https://sqs.us-west-2.amazonaws.com/123456789012/...` 格式。

### CR-02: API Key 认证使用明文比较，存在时序攻击风险

- **文件**: `middleware/auth.js`（第 33 行）
- **问题**: `providedKey !== configuredKey` 使用 `!==` 进行字符串比较，攻击者可通过响应时间差异逐字节猜测 API Key。
- **建议**: 使用 `crypto.timingSafeEqual()` 进行常量时间比较：
  ```js
  const crypto = require('crypto')
  const a = Buffer.from(providedKey)
  const b = Buffer.from(configuredKey)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) { ... }
  ```

### CR-03: `express.json()` 未设置 body 大小限制

- **文件**: `server.js`（第 38 行）
- **问题**: `app.use(express.json())` 未指定 `limit` 参数，默认 100KB。但 `PATCH /:id/report` 路由接收完整报告 JSON（可能很大），而 `PUT /:id` 路由的 `content` 字段也可以是任意大小。攻击者可发送超大 JSON body 导致内存耗尽。
- **建议**: 显式设置合理限制：`app.use(express.json({ limit: '5mb' }))`。

### CR-04: report-worker 中 `processMessage` 失败后既标记 `failed` 又 `throw`，导致 SQS 无限重试

- **文件**: `workers/report-worker.js`（第 248-270 行）
- **问题**: 当 `retryCount < 3` 时，worker 将状态更新为 `failed`，然后 `throw err`。由于消息未被删除，SQS visibility timeout 后会重新投递。但下次处理时，`stage` 已经是 `failed` 而非 `generating`，`ConditionExpression` (`stage <> :stage`) 不会阻止重复处理。同时 `retryCount` 每次递增，最终会超过 3 次限制。但在此期间，用户看到的状态是 `failed`，可能触发手动重试，造成竞态。
- **建议**: 失败时应将状态设为 `pending`（而非 `failed`），或者在 `retryCount < 3` 时不 throw（让消息被删除），改为主动重新入队。

### CR-05: transcription-worker 失败后 throw 导致消息永远不会被删除

- **文件**: `workers/transcription-worker.js`（第 310 行）
- **问题**: 当 `retryCount >= 3` 时，worker 标记为 `failed` 后仍然 `throw err`。这意味着消息不会被 `deleteMessage` 删除。如果 SQS 队列没有配置 DLQ（Dead Letter Queue），消息会在 maxReceiveCount 次后才进入 DLQ，或者无限重试。
- **建议**: 当 `retryCount >= 3` 时，不要 throw，让消息正常删除。或确保 SQS 队列配置了 DLQ。

---

## 🟡 Medium（中等问题）

### CR-06: `listMeetings()` 对 7 个状态并行 Query，无分页支持

- **文件**: `services/meeting-store.js`（第 11-28 行）
- **问题**: 每次列表请求发起 7 个并行 DynamoDB Query，每个 Query 默认返回最多 1MB 数据（无 `Limit`）。随着会议数量增长，这会导致：(1) 响应时间线性增长；(2) 大量 DynamoDB 读取容量消耗；(3) 前端一次性加载所有数据。
- **建议**: 添加分页参数（`limit`/`lastKey`），或使用单次 Scan + FilterExpression 替代多次 Query。

### CR-07: `PATCH /:id/report` 的 `fieldMap` 不完整，部分 section 写入时会写到 `undefined` 字段

- **文件**: `routes/meetings/report.js`（第 195-204 行）
- **问题**: `validSections` 包含 `topics`, `teamKPI`, `nextMeeting`, `risks` 等，但 `fieldMap` 只映射了 8 个字段。当用户 PATCH `topics` 时，`fieldMap["topics"]` 为 `undefined`，导致 `report[undefined] = data`，实际数据丢失。
- **建议**: 补全 `fieldMap`，或直接使用 `report[section] = data`（因为 `validSections` 已经做了白名单校验）。

### CR-08: S3 stream 读取未设置超时，大文件可能导致请求挂起

- **文件**: `routes/meetings/report.js`（多处）、`routes/meetings/core.js`（第 87-93 行）
- **问题**: 多处使用 `for await (const chunk of stream)` 读取 S3 stream，但没有设置超时。如果 S3 响应缓慢或网络中断，请求会无限挂起。
- **建议**: 使用 `AbortController` 为 S3 GetObject 设置超时，或使用 `stream.pipeline` 配合超时。

### CR-09: `sanitizeFilename` 过于激进，中文文件名会被完全替换为下划线

- **文件**: `routes/meetings/helpers.js`（第 47-51 行）
- **问题**: `name.replace(/[^\w\-_.]/g, "_")` 中 `\w` 只匹配 `[a-zA-Z0-9_]`，中文字符会被替换为 `_`。对于中文用户，文件名会变成 `_________.mp3`。
- **建议**: 改为只过滤危险字符：`name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")`。

### CR-10: `gpu-autoscale.js` 中 `startInstance()` 的 fallback 逻辑会修改实例类型但不会恢复

- **文件**: `services/gpu-autoscale.js`（第 68-107 行）
- **问题**: 当所有重试失败后，fallback 逻辑会尝试修改 EC2 实例类型。如果某个 fallback 类型成功启动，实例类型就永久改变了。下次正常启动时不会恢复到原始类型。
- **建议**: 记录原始实例类型，在 fallback 成功后记录日志提醒运维恢复，或在下次启动前自动恢复。

### CR-11: `report-worker` 和 `transcription-worker` 的 `recoverStaleMeetings` 每次 poll 都执行

- **文件**: `workers/report-worker.js`（第 73 行，在 `poll()` 循环中）
- **问题**: `recoverStaleMeetings()` 在每次 5 秒的 poll 循环中都执行，但它查询的是 15 分钟前的 stale 记录。每 5 秒查一次 DynamoDB 是浪费。
- **建议**: 添加节流逻辑，例如每 5 分钟执行一次 stale recovery。

### CR-12: `export-worker` 没有重试计数，失败消息可能无限重试

- **文件**: `workers/export-worker.js`（第 95-110 行）
- **问题**: 与 report-worker 和 transcription-worker 不同，export-worker 在失败时直接 throw，没有 retryCount 机制。如果 SES 持续失败（如邮箱不存在），消息会无限重试直到 SQS maxReceiveCount。
- **建议**: 添加与其他 worker 一致的 retryCount 逻辑。

### CR-13: CORS 配置硬编码了内网 IP

- **文件**: `server.js`（第 28 行）
- **问题**: `origin: ["http://localhost:3300", "http://172.31.21.140:3300"]` 硬编码了内网 IP。这在部署环境变更时需要修改代码。
- **建议**: 将 CORS origin 移到环境变量：`CORS_ORIGINS=http://localhost:3300,http://172.31.21.140:3300`。

### CR-14: `auto-name` 路由在请求处理中 `require()` AWS SDK

- **文件**: `routes/meetings/report.js`（第 233 行）
- **问题**: `const { BedrockRuntimeClient, InvokeModelCommand } = require("@aws-sdk/client-bedrock-runtime")` 在路由处理函数内部调用。虽然 Node.js 会缓存 `require()`，但这是不规范的做法，且创建了一个新的 `BedrockRuntimeClient` 实例（而非复用 `services/bedrock.js` 中的）。
- **建议**: 将 `require` 移到文件顶部，复用 `services/bedrock.js` 中的 client，或在 bedrock service 中添加一个 `invokeHaiku()` 方法。

### CR-15: `readTranscriptParts` 中 FunASR 文本截断为 350000 字符，但 `truncateTranscript` 也会截断

- **文件**: `routes/meetings/helpers.js`（第 115 行）、`services/bedrock.js`（第 117 行）
- **问题**: 转录文本在 `readTranscriptParts` 中被截断为 350000 字符，然后在 `truncateTranscript` 中又被截断为 350000。双重截断逻辑分散在两个文件中，容易不一致。
- **建议**: 统一在 `truncateTranscript` 中处理截断，`readTranscriptParts` 不做截断。

### CR-16: `meeting-store.js` 中 `GLOSSARY_TABLE` fallback 到 `DYNAMODB_TABLE`

- **文件**: `services/meeting-store.js`（第 8 行）
- **问题**: `const GLOSSARY_TABLE = process.env.GLOSSARY_TABLE || process.env.DYNAMODB_TABLE` — 如果 `GLOSSARY_TABLE` 未设置，会使用会议表作为词汇表，导致数据混乱。
- **建议**: 移除 fallback，要求 `GLOSSARY_TABLE` 必须显式设置，或在启动时校验。

### CR-17: `transcription-worker` S3 Event dedup 查询所有 7 个状态

- **文件**: `workers/transcription-worker.js`（第 195-215 行）
- **问题**: 对每个 S3 Event 消息，worker 串行查询 7 个状态的 GSI 来检查重复。这在高并发上传时会成为瓶颈。
- **建议**: 使用 DynamoDB 的 `PutItem` + `ConditionExpression` 实现幂等性，或使用单次 Query 按 s3Key 查询（需要新建 GSI）。

---

## 🟢 Low（低优先级）

### CR-18: `logger.js` 缺少 `debug` 级别

- **文件**: `services/logger.js`
- **问题**: `ffmpeg.js` 中调用了 `logger.debug()`（第 55、60 行），但 logger 模块只定义了 `info`、`warn`、`error`。调用 `logger.debug()` 会抛出 `TypeError: logger.debug is not a function`。
- **建议**: 在 logger 中添加 `debug` 方法，或将 ffmpeg.js 中的 `logger.debug` 改为 `logger.info`。

### CR-19: `_EXPORT_QUEUE_URL` 变量声明但未使用

- **文件**: `workers/report-worker.js`（第 22 行）
- **问题**: `const _EXPORT_QUEUE_URL = process.env.SQS_EXPORT_QUEUE` 以下划线前缀声明但从未使用（report-worker 不再自动触发 export）。
- **建议**: 删除该变量。

### CR-20: `helpers.js` 中 `TABLE` 和 `GLOSSARY_TABLE` 导出但未在外部使用

- **文件**: `routes/meetings/helpers.js`（第 6-7 行）
- **问题**: `TABLE` 和 `GLOSSARY_TABLE` 常量被导出，但路由文件通过 `store` 和 `glossaryStore` 模块访问数据库，不直接使用这些常量。
- **建议**: 移除未使用的导出。

### CR-21: `SPA fallback` 路由不会返回 404 给未知 API 路径

- **文件**: `server.js`（第 68-72 行）
- **问题**: `app.get('*', ...)` 会将所有非 API 的 GET 请求返回 `index.html`。但对于 `GET /api/nonexistent`，由于路径以 `/api` 开头，条件 `!req.path.startsWith('/api')` 为 false，请求会落到 Express 默认的 404 处理。这是正确的，但 `POST /nonexistent` 等非 GET 请求不会被这个 fallback 捕获，也不会返回有意义的错误。
- **建议**: 在 SPA fallback 之前添加 `app.all('/api/*', (req, res) => res.status(404).json(...))`。

### CR-22: `meetingUpdateSchema` 中 `status` 字段未限制枚举值

- **文件**: `routes/meetings/core.js`（第 22 行）
- **问题**: `status: z.string().optional()` 允许任意字符串作为状态值。用户可以将状态设为任意值（如 `"hacked"`），破坏状态机。
- **建议**: 使用 `z.enum(["pending", "processing", "transcribed", "reported", "completed", "failed", "created", "uploaded"])`。

### CR-23: `deleteGlossaryItem` 不检查记录是否存在

- **文件**: `routes/glossary.js`（第 103-109 行）
- **问题**: 删除词汇表条目时不检查 `termId` 是否存在，DynamoDB `DeleteCommand` 对不存在的 key 不会报错，直接返回 204。
- **建议**: 添加 `ConditionExpression: "attribute_exists(termId)"` 或先查询再删除。

### CR-24: `report-worker` 中 `recordActivity()` 只在成功时调用

- **文件**: `workers/report-worker.js`（第 222 行）
- **问题**: `recordActivity()` 用于重置 GPU 空闲计时器，但只在报告生成成功时调用。如果报告生成失败但 GPU 仍在使用中（如 transcription-worker 正在处理其他任务），空闲计时器可能过早触发关机。
- **建议**: 在 `processMessage` 开始时也调用 `recordActivity()`。

### CR-25: `server.js` 中 `trust proxy` 设为 1，但未验证代理链

- **文件**: `server.js`（第 27 行）
- **问题**: `app.set("trust proxy", 1)` 信任第一个代理的 `X-Forwarded-For` 头。如果应用直接暴露在公网（无反向代理），攻击者可以伪造 IP 地址绕过 rate limiting。
- **建议**: 确认部署架构中确实有反向代理，或在无代理时设为 `false`。

### CR-26: `report.js` 中 `PATCH` 路由的 `fieldMap` 与 `validSections` 不同步

- **文件**: `routes/meetings/report.js`（第 183-204 行）
- **问题**: `validSections` 有 21 个值，`fieldMap` 只有 8 个映射。对于 `fieldMap` 中没有的 section（如 `topics`），`primaryField` 为 `undefined`，`report[undefined] = data` 不会报错但数据丢失。这与 CR-07 相同，此处补充：`fieldMap` 的存在本身是多余的，因为 section 名称和 report 字段名完全一致。
- **建议**: 直接使用 `report[section] = data`。

---

## 📊 总结

| 严重程度 | 数量 | 关键领域 |
|---------|------|---------|
| 🔴 Critical | 5 | 安全（时序攻击、body 限制）、SQS 重试逻辑 |
| 🟡 Medium | 12 | 性能（DynamoDB 查询）、可靠性（超时、重试）、代码质量 |
| 🟢 Low | 9 | 死代码、命名、防御性编程 |

**优先修复建议**:
1. CR-02（时序攻击）和 CR-03（body 限制）— 安全问题，立即修复
2. CR-04 和 CR-05（SQS 重试逻辑）— 影响生产可靠性
3. CR-07/CR-26（PATCH fieldMap）— 功能性 bug，用户编辑部分 section 时数据丢失
4. CR-18（logger.debug）— 运行时错误，ffmpeg 合并时会崩溃
