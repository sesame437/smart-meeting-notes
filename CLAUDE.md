# CLAUDE.md — Meeting Minutes

会议录音转录 + 智能纪要生成。上传音频 → FunASR 转录 → Bedrock 生成纪要 → SES 发邮件。
端口：3300 | 前端：Vue 3 + Vite

## Stack
- Node.js / Express + DynamoDB + S3 + SQS
- AI: Bedrock Claude Sonnet 4.6（us-west-2）
- 转录: FunASR（172.31.27.101:9002，按需启动）
- 邮件: SES（us-west-2，qiankai@amazon.com）

## Structure
- server.js — Express 入口，只做 require + app.use
- routes/meetings/ — core / report / email / helpers
- services/ — bedrock / s3 / ses / sqs
- workers/ — transcription / report / export / gpu-autoscale
- src/ — Vue 3（views/ components/ stores/ api/）
- __tests__/ — Jest 单元测试
- e2e/ — Playwright E2E

## Commands
- Dev: node server.js
- Test: npm test（基线：539+ passed，覆盖率 ≥ 87%）
- E2E: npx playwright test e2e/（服务需先启动）
- Lint: npm run lint

## Don't
- ❌ 新路由写在 server.js → 在 routes/ 建文件
- ❌ DynamoDB 存带 PREFIX 的 S3 Key → 存裸 key，service 层加 PREFIX
- ❌ SES 用 us-east-1 → 固定 us-west-2
- ❌ 内联 script 或 onclick="" → 外链 JS + 事件委托
- ❌ Vue 组件超 200 行 → 拆子组件

## S3 Key 格式（存裸 key）
- s3Key: inbox/{meetingId}/{filename}
- reportKey: reports/{meetingId}/report.json
- funasrKey: transcripts/{meetingId}/funasr.json

## Lessons
- SES 发失败 → 用了 us-east-1 → 固定 us-west-2
- S3 去重失败 → key 格式不一致 → 统一存裸 key
- DynamoDB 手动操作丢字段 → PutItem 只写部分 → 先 GetItem 读完整再写回

## Refs
- .claude/rules/coding.md / testing.md / api.md / data.md / vue.md
