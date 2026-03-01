# PROGRESS.md - 当前进度

> cc 每次 session 开始必读此文件，结束必更新。

最后更新：2026-03-01

---

## 当前状态

- 服务：port 3300，正常运行
- 测试：432 passed (Jest) + 8 passed / 2 skipped (Playwright)
- 覆盖率：Statements 79%，Branches 70%，Functions 77%
- 架构评分：92/100（v3.0 评分表）

## 最近完成（最新在前）

- [x] Playwright E2E 测试：home/glossary/report 三个页面核心流程（commit `aef660a`）
- [x] DynamoDB gpu-autoscale Scan → 并行 QueryCommand，复用 status-createdAt-index GSI（commit `7ff3e1b`）
- [x] zod 高风险路由校验：upload/merge/speaker-names/speaker-map（commit `b67e739`）
- [x] workers 单元测试：transcription-worker + report-worker（commit `b67e739`）
- [x] readFileSync → fs.promises.readFile，lint warnings 减少，supertest 补全（commit `8a317cd`）
- [x] s3.js + bedrock.js 单元测试，覆盖率提升（commit `e28c4bd`）
- [x] core-routes + email-route supertest（commit `8ac9a0a`）
- [x] export-worker 拆分 email-templates/（commit `a52a9ec`）
- [x] DB 层分离：meeting-store.js + glossary-store.js，路由层 0 处 docClient（commit `23a476d`）
- [x] ESLint flat config v10 + Prettier（commit `ca668ba`）

## 下一步（按优先级）

- [ ] zod 校验剩余 14 个路由（当前只覆盖了 4 个高风险路由）
- [ ] listMeetings 全表 Scan → GSI（需凯确认 DynamoDB 表结构变更）
- [ ] OpenAPI 文档（swagger-jsdoc）
- [ ] workers/ 覆盖率提升（当前 workers 逻辑测试较少）
- [ ] lint warnings 从 14 降到 0

## 已知问题 / 注意事项

- `listMeetings()` 仍是全表 Scan，数据量大时有性能风险，等凯确认 GSI 方案
- SES 固定用 us-west-2（qiankai@amazon.com 在此 region 验证），不要改 region
- S3 Key 存裸格式（无 PREFIX），service 层统一拼接，不要在 routes 层拼

## 关键文件位置

- 路由：`routes/meetings/`（core/report/email/helpers）、`routes/glossary.js`
- 服务层：`services/`（meeting-store/glossary-store/s3/bedrock/gpu-autoscale）
- Workers：`workers/`（transcription/report/export + email-templates/）
- 测试：`tests/`（Jest 432 passed）、`e2e/`（Playwright 8 passed）
- 规范：`.claude/rules/`（api/coding/testing/data）
