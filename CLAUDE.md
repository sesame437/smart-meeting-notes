# CLAUDE.md — Meeting Minutes AI 操作手册
> 这是地图，不是手册。细节在 .claude/rules/ 和 .spec/。
> **版本：2026-03-03 v2.0（对齐 DEV_MODE v3.0）**

---

## ⚡ Session 开始必做（每次）
1. 读 `PROGRESS.md`（若存在）— 了解当前进度和已知问题
2. `npm test` — 确认测试基线（454 unit tests），有失败先修再动手

---

## 项目概览
会议录音转录 + 智能纪要生成服务。上传音频 → FunASR 转录 → Bedrock 生成纪要 → SES 发送邮件。

**端口：3300 | 前端：Vue 3 + Vite（dist/）**

---

## 技术栈
- Runtime: Node.js / Express
- 数据库: DynamoDB (`meeting-minutes-meetings`)
- 存储: S3 (`yc-projects-012289836917`，prefix: `meeting-minutes/`)
- 队列: SQS (`mm-transcription-queue`)
- AI: AWS Bedrock Claude Sonnet 4.6（us-west-2）
- 转录: FunASR（EC2 g6.2xlarge，172.31.27.101:9002，按需启动）
- 邮件: AWS SES（us-west-2，qiankai@amazon.com）
- 前端: Vue 3 + Vite（`src/` → build → `dist/`）

---

## 文件结构
- `server.js` — Express 入口 + static dist/
- `routes/meetings/` — core.js / report.js / email.js / helpers.js
- `routes/glossary.js` — 词库 API
- `services/` — bedrock / s3 / ses / sqs
- `workers/` — transcription / report / export / gpu-autoscale
- `db/dynamodb.js` — DynamoDB 客户端
- `src/` — Vue 3 源码（views/ components/ stores/ api/）
- `e2e/` — Playwright E2E 测试
- `__tests__/` — Jest 单元测试

---

## 禁止行为（含修复指导）

- ❌ 新路由写在 server.js
  ✅ 正确：routes/ 建新文件，server.js 只做 require + app.use

- ❌ DynamoDB 存带 PREFIX 的 S3 Key
  ✅ 正确：永远存裸 key（`inbox/{id}/file.mp4`），services/s3.js 内部加 PREFIX

- ❌ 业务代码拼 `${S3_PREFIX}/...`
  ✅ 正确：调用 s3.uploadFile(bareKey) / s3.getFile(bareKey)，service 层封装

- ❌ SES 发邮件用 us-east-1
  ✅ 正确：固定 us-west-2，发件人 qiankai@amazon.com

- ❌ 内联 script 块或 onclick="" 属性（CSP 违规）
  ✅ 正确：外链 JS + data-action + 事件委托

- ❌ 前端 Vue 组件超过 200 行
  ✅ 正确：拆子组件，每个 ≤200 行

- ❌ 引入未在 package.json 的依赖
  ✅ 正确：先 npm install --save，再使用

---

## 三层验证（每次任务必须全部通过后才能 commit）

### Layer 1：单元测试
```bash
npm test
# 要求：454+ passed，0 failed，覆盖率 ≥ 79%
```

### Layer 2：API 集成
```bash
node server.js &; sleep 3
curl -sf localhost:3300/health | jq '.status == "ok"'
kill %1
```

### Layer 3：Playwright E2E
```bash
NODE_ENV=production npm run build && node server.js &; sleep 3
npx playwright test e2e/ --reporter=list
kill %1
```

**E2E 规则：**
- 新功能必须同步编写 e2e/<feature>.spec.js，**同一个 commit 提交**
- skip 不算通过，必须说明原因
- 截图保存 e2e/screenshots/，必须有真实数据

### 汇报格式（汇报给今朝时必须包含）
```
✅ Unit: N passed / 覆盖率 X%
✅ API: /health 200
✅ E2E: N passed，截图：e2e/screenshots/...
📝 踩坑：[已写入 CLAUDE.md 历史教训]
🔗 Commit: <hash>
```

---

## 字段格式（Single Source of Truth）

### S3 Key（DynamoDB 存裸 key）
| 字段 | 格式 |
|------|------|
| s3Key | `inbox/{meetingId}/{filename}` |
| reportKey | `reports/{meetingId}/report.json` |
| funasrKey | `transcripts/{meetingId}/funasr.json` |

### 枚举值
- `followUps.status`：`new` / `in-progress` / `blocked` / `done`
- 会议类型：`general` / `tech` / `weekly` / `customer` / `merged`

完整 Report JSON 字段定义见 `.claude/rules/data.md`

---

## 服务管理
```bash
systemctl --user restart meeting-minutes
NODE_ENV=production node server.js  # 生产启动
```

---

## 参考文档
- `.claude/rules/coding.md` — 编码规范
- `.claude/rules/testing.md` — 测试规范（E2E 详细规则在此）
- `.claude/rules/api.md` — HTTP/错误格式规范
- `.claude/rules/data.md` — DynamoDB + Report JSON 完整字段
- `.claude/rules/vue.md` — Vue 3 开发规范

---

## 历史教训（格式：[日期] 问题 → 根因 → 修复）
- [2026-02-22] SES 发失败 → 用了 us-east-1 → 固定 us-west-2
- [2026-02-27] S3 Event 去重失败 → s3Key 格式不一致（带/不带 PREFIX）→ 统一存裸 key
- [2026-02-27] DynamoDB 手动操作丢字段 → PutItem 只写部分字段 → 先 GetItem 读完整再写回
- [2026-02-28] cc 直接退出无输出 → exec 没有设 workdir → 必须带 workdir 参数
- [2026-03-02] E2E 报告"8 passed"是假通过 → test.skip 被忽略 → skip≠通过，必须检查原因
- [2026-03-02] Batch 完成后没跑 E2E 就 push → E2E 必须与功能同 commit，不允许事后补
- [2026-03-02] cc 重构时误删函数 → app.js 单文件 2600 行 → Vue 3 迁移，组件 ≤200 行
