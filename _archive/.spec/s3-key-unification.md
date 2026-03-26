# S3 Key 统一规范 — Spec

## 背景
DynamoDB 中 s3Key / reportKey / transcriptKey 存储格式不统一：
- s3Key（音频）：存裸 key（不带前缀）`inbox/xxx/file.mp4`
- reportKey：存 fullKey（带前缀）`meeting-minutes/reports/xxx/report.json`
- transcriptKey：存 fullKey（带前缀）

这种不一致导致：
1. S3 Event 去重失败（带前缀 vs 不带前缀，永远 match 不上）→ 重复记录
2. PATCH /report 写回 S3 时要 hardcode strip prefix
3. report-worker 手动拼 fullReportKey，脆弱

## 统一规范
**所有 key 存 DynamoDB 时一律存裸 key（不带 PREFIX）**
- `s3Key`: `inbox/{meetingId}/{filename}`  ✅ 已是裸 key，不变
- `reportKey`: `reports/{meetingId}/report.json`（去掉 meeting-minutes/ 前缀）
- `transcribeKey/whisperKey/funasrKey`: `transcripts/{meetingId}/xxx.json`（去掉 meeting-minutes/ 前缀）
- `getFile(key)` 内部自动补前缀（现有逻辑保留，兼容过渡）
- `uploadFile(key)` 传裸 key，返回值统一丢弃（内部加前缀，调用方不感知）

## 改动清单

### 1. services/s3.js
- `uploadFile` 返回裸 key（去掉 return fullKey，改 return key）
- `getFile` 保持不变（startsWith 补全逻辑）

### 2. routes/meetings.js

**upload 路由（L236-270）**
- s3Key 已是裸 key，存 DynamoDB 不变 ✅

**merge 路由（L439-470）**
- `const fullReportKey = await uploadFile(...)` → `await uploadFile(...)`（丢弃返回值）
- DynamoDB Item 里 `reportKey: fullReportKey` → `reportKey: reportKey`（裸 key）

**regenerate 路由（L628-660）**
- `const fullReportKey = await uploadFile(...)` → `await uploadFile(...)`
- UpdateCommand 里 `":rk": fullReportKey` → `":rk": reportKey`（裸 key）

**speaker-map 路由（L703-730）**
- 已有 `await uploadFile(reportKey, ...)` + 手动 `fullReportKey = ${PREFIX}/${reportKey}` → 删掉手动拼接
- UpdateCommand 里 `":rk": fullReportKey` → `":rk": reportKey`（裸 key）

**PATCH /report 写回（L783）**
- `item.reportKey.replace(/^meeting-minutes\//, "")` → 直接 `item.reportKey`（已是裸 key）

### 3. workers/report-worker.js

**report 生成后写 DynamoDB（L208-220）**
- `await uploadFile(reportKey, ...)` 返回值丢弃
- 手动拼 `fullReportKey = ${process.env.S3_PREFIX}/${reportKey}` → 删掉
- UpdateCommand 里 `":rk": fullReportKey` → `":rk": reportKey`（裸 key）

### 4. workers/transcription-worker.js

**转录结果 key 存 DynamoDB（L388-421）**
- `transcribeKey`/`whisperKey`/`funasrKey` 的 outputKey 目前是 `${PREFIX}/transcripts/...`（带前缀）
- 改为裸 key：`transcripts/${meetingId}/transcribe.json`（去掉 `${PREFIX}/` 前缀）
- 存 DynamoDB 时不变，getFile 读取自动补前缀

**S3 Event 去重（L290-315）**
- FilterExpression `s3Key = :key` 中的 `:key` 目前是 S3 Event 带前缀的 key
- 改为 strip 前缀后比较：`const bareKey = s3Key.startsWith(PREFIX+"/") ? s3Key.slice(PREFIX.length+1) : s3Key`
- FilterExpression 用 bareKey 查询

## 验收标准
- [ ] npm test 291 个全通过
- [ ] DynamoDB 里新上传的会议 reportKey 是裸 key（`reports/xxx/report.json`）
- [ ] S3 Event 重复上传同一文件，第二次被去重跳过（日志出现 [Dedup] Skipping）
- [ ] PATCH /report 内联编辑正常保存
- [ ] regenerate/speaker-map 重新生成报告正常
- [ ] CSP 合规，无 onclick
- [ ] git commit + push
