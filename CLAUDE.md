# CLAUDE.md — Meeting Minutes AI 操作手册
> 这是地图，不是手册。细节在 ROADMAP.md、routes/、workers/。

## 项目概览
会议录音转录 + 智能纪要生成服务。上传音频 → FunASR 转录 → Bedrock 生成纪要 → SES 发送邮件。

## 技术栈
- Runtime: Node.js
- 框架: Express
- 数据库: DynamoDB (via @aws-sdk/lib-dynamodb)
- 存储: S3（音频文件）
- 队列: SQS（转录任务分发）
- AI: AWS Bedrock Claude Sonnet 4.6（报告生成）
- 转录: FunASR (EC2 g6.2xlarge，CAM++ 说话人分离)
- 邮件: AWS SES (us-west-2, qiankai@amazon.com)
- 前端: 原生 HTML/CSS/JS

## 文件结构
- `server.js` — Express 入口，只在这里 require routes
- `routes/meetings.js` — 会议 CRUD API
- `routes/glossary.js` — 词库管理 API
- `services/bedrock.js` — Bedrock 报告生成
- `services/s3.js` — S3 文件操作
- `services/ses.js` — 邮件发送（SES us-west-2）
- `services/sqs.js` — SQS 消息操作
- `workers/transcription-worker.js` — 拉 SQS → 调 FunASR → 存转录结果
- `workers/report-worker.js` — 转录完成 → 调 Bedrock → 生成纪要
- `workers/export-worker.js` — 生成 PDF/HTML → SES 发送
- `db/dynamodb.js` — DynamoDB 客户端初始化

## AWS 资源
- S3 Bucket: `yc-projects-012289836917`，prefix: `meeting-minutes/`
- DynamoDB Table: `meeting-minutes-meetings`
- SQS Queue: `mm-transcription-queue`
- SES Region: `us-west-2`，发件人: `qiankai@amazon.com`
- FunASR EC2: `ssh funasr`（172.31.27.101，按需启动）

## 禁止行为（含修复指导）

- ❌ 直接修改 DynamoDB 表结构（加字段等）
  ✅ 正确：在 db/migrations/ 写迁移脚本，或直接用 AWS CLI `aws dynamodb update-table`，并更新 README

- ❌ 新路由写在 server.js 而非 routes/
  ✅ 正确：在 routes/ 建新文件，server.js 只做 require 和 app.use 注册

- ❌ 在 workers/ 里直接 require 其他 worker（循环依赖）
  ✅ 正确：公共逻辑提取到 services/，workers 各自独立

- ❌ 暴露 AWS 凭证、API Key 在代码或日志
  ✅ 正确：从 process.env 读取，.env 文件不提交

- ❌ 邮件发送用 us-east-1
  ✅ 正确：SES 必须用 us-west-2（qiankai@amazon.com 在此 region 验证）

- ❌ 引入未在 package.json 的新依赖
  ✅ 正确：先 `npm install --save <pkg>`，再使用

## 模块质量现状
| 模块 | 质量 | 主要 Tech Debt |
|------|------|----------------|
| 会议 CRUD API | ✅ 稳定 | 无 |
| 转录 Worker | ✅ 稳定 | FunASR 说话人分离准确度待验证 |
| 报告生成 | ⚠️ 可用 | SPEAKER_X 标签出现在正文（P1 bug）|
| 邮件发送 | ⚠️ 可用 | PDF 附件意义不大，计划改 HTML 邮件（P2）|
| 词库管理 | ⚠️ 仅 API | 无管理 UI，只能 CLI 操作 |
| 前端 UI | ⚠️ 可用 | 无自动化测试 |

## 服务管理
```bash
systemctl --user restart meeting-minutes
systemctl --user status meeting-minutes
# Workers 单独运行
node workers/transcription-worker.js
node workers/report-worker.js
```
端口: 3300

## 参考文档
- 路线图 + 待办: ROADMAP.md（先读这里了解 P1/P2 bug）
- 上传脚本: scripts/upload_meeting.py（Mac 使用，已部署到 /usr/local/bin/mm）

## 历史教训（每次纠错后更新）
- 2026-02-22：Python 脚本含中文注释必须加 `# -*- coding: utf-8 -*-`，否则 Mac 下载后乱码。
- 2026-02-22：SES 邮件发送必须用 us-west-2，qiankai@amazon.com 在此 region 验证。us-east-1 只有 sesame.qian@gmail.com 可用。
- 重要架构决策不留在飞书对话，直接写入此文件。cc 看不到飞书，对它来说等同于不存在。

## 前端 CSP 规范（必须遵守）

本项目使用 helmet，默认启用严格 CSP，国内网络环境下尤为重要。

**禁止：**
- `<script>` 内联块（必须放外链 .js 文件）
- `onclick="..."` 等内联事件属性
- CDN 外链（cloudflare/jsdelivr 在国内不稳定）

**必须：**
- 所有按钮用 `data-action` + `document.addEventListener("click", ...)` 事件委托
- 页面初始化在 DOMContentLoaded 里按 URL/DOM 特征判断页面类型
- Font Awesome 等静态资源本地化（放 public/css/ + public/fonts/）

## Quality Gate（必须执行）

每个功能完成后必须：

1. **node --check** 所有修改的 .js 文件
2. **npm test** 补充/运行 unit test（正常路径 + 边界 + 错误路径）
3. **前端功能**：用 browser 工具打开 http://localhost:3300，Console 确认：
   - 无 CSP 错误（`Refused to execute inline script`）
   - 无 JS SyntaxError / ReferenceError
   - 功能操作正常
4. **git commit**

## CSP 配置（server.js）

helmet 已配置明确的 CSP 白名单（见 server.js），规则：
- `scriptSrc: ["'self'"]` — 禁止内联 script，只允许外链 .js 文件
- `styleSrc: ["'self'", "'unsafe-inline'"]` — 允许 inline style
- 禁止任何外部 CDN（cloudflare/jsdelivr 等）
- 所有字体/图标/CSS 必须本地化到 public/ 目录

**新增静态资源时**：更新 server.js 的 CSP directives，而不是用 `unsafe-inline` 或 `unsafe-eval`。
