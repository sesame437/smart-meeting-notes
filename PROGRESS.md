# PROGRESS.md - 当前进度

> cc 每次 session 开始必读此文件，结束必更新。

最后更新：2026-03-02

---

## 当前状态

- 服务：port 3300，正常运行
- 测试：454 passed (Jest) + 8 passed / 7 skipped (Playwright)
- 架构评分：92/100（v3.0 评分表）
- Lint：0 errors, 0 warnings

## 最近完成（最新在前）

- [x] zod 校验补全 + E2E 测试 + lint warnings 清零（3合1）：glossary/meetings 路由 zod 校验 + e2e/edit.spec.js + eslint no-unused-vars 规则完善
- [x] 数据字段全面统一：11个旧别名全部清零（actionItems/keyDecisions/agenda_items/executive_summary等）（commit `4189fd9`）
- [x] data.md 补全：DynamoDB表结构、Report JSON完整定义（按会议类型）、字段命名铁律（commit `916c1f2`）
- [x] vue.md 新增：Vue 3 + Vite 开发规范（文件结构/组件规范/Pinia/API层）（commit `916c1f2`）
- [x] 统一编辑 UX 全量迁移：renderEditableList 覆盖所有字段（commit `cff2592`/`e885b20`）
- [x] 浏览器缓存修复：express.static maxAge=0 + content-hash query string（commit `0bbaf1b`/`80c2f2f`）
- [x] FunASR 冷启动修复：子模型持久化 + Worker 重试机制（commit `bbcf5f6`）
- [x] 多段录音合并：ffmpeg 合并 + 前端多文件上传（commit `17b7a91`/`731ae12`）
- [x] Bedrock regenerate 健壮解析（commit `fa3e039`）

## 下一步（按优先级）

### 🔴 高优先级
- [ ] **Vue 3 + Vite 迁移**（Batch 1-5）：先用 BN2 出 Mock 给凯确认视觉，再动代码

### 🟢 低优先级
- [ ] listMeetings GSI：需凯确认 DynamoDB schema 变更后执行
- [ ] OpenAPI 文档（swagger-jsdoc）

## 已知问题 / 注意事项

- `listMeetings()` 仍是全表 Scan，等凯确认 GSI 方案
- SES 固定用 us-west-2（qiankai@amazon.com 在此 region 验证），不要改 region
- S3 Key 存裸格式（无 PREFIX），service 层统一拼接，不要在 routes 层拼
- Vue 迁移前必须先出 BN2 Mock 图给凯确认视觉方向

## 关键文件位置

- 路由：`routes/meetings/`（core/report/email/helpers）、`routes/glossary.js`
- 服务层：`services/`（meeting-store/glossary-store/s3/bedrock/gpu-autoscale）
- Workers：`workers/`（transcription/report/export + email-templates/）
- 测试：`tests/`（Jest 454 passed）、`e2e/`（Playwright 8 passed + 新增 edit.spec.js）
- 规范：`.claude/rules/`（api/coding/testing/data/vue）
- Spec：`.spec/features/unified-edit-ux.md`
