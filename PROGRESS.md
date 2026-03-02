# PROGRESS.md - 当前进度

> cc 每次 session 开始必读此文件，结束必更新。

最后更新：2026-03-02（今朝自主完成）

---

## 当前状态

- 服务：port 3300，正常运行
- 测试：456 passed (Jest) + 8 passed / 7 skipped (Playwright)
- 架构评分：92/100（v3.0 评分表）
- Lint：0 errors, 0 warnings
- Vue SPA：dist/ 可部署，server.js 已配置生产模式 serve

## 最近完成（最新在前）

- [x] **周会 UI 重设计 + SpeakerRow 拆分**（3 Batch 完成，commit `df7c8e0`）
  - Batch 0（前置）：SpeakerRow 拆分（295→154行），提取 SpeakerSearchDropdown（commit `f171b5a`）
  - Batch 1（骨架）：TeamKPICard + ProjectAccordion + WeeklySidebar 三个新组件（commit `2a2911b`）
  - Batch 2（组装）：WeeklySection 重构（138行）+ 移动端适配 + 左侧导航（commit `df7c8e0`）
- [x] **Speaker 识别 × 词汇表人员打通**（2 Batch 完成）
  - Batch 1（后端）：glossary category 过滤 + Bedrock 提取 speakerKeypoints（commit `ca8fd92`）
  - Batch 2（前端）：SpeakerMap keypoints 显示 + 词汇表人员 tab + 实时搜索（commit `798b6f8`）
- [x] Vue Batch 5 完成：Toast + ConfirmDialog + UploadArea + server.js 生产模式
- [x] Vue Batch 4 完成：ProjectReview + SpeakerMap + WeeklySection + GlossaryView 完整实现（commit `8bfde1f`）
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
- [ ] **Vue 3 + Vite 激活**：验证 dist/ 生产环境可用性，决定是否切换默认前端
- [ ] **HomeView 增强**：搜索/筛选/排序功能

### 🟢 低优先级
- [ ] listMeetings GSI：需凯确认 DynamoDB schema 变更后执行
- [ ] OpenAPI 文档（swagger-jsdoc）

## 已知问题 / 注意事项

- `listMeetings()` 仍是全表 Scan，等凯确认 GSI 方案
- SES 固定用 us-west-2（qiankai@amazon.com 在此 region 验证），不要改 region
- S3 Key 存裸格式（无 PREFIX），service 层统一拼接，不要在 routes 层拼
- Vue 前端已完成基础功能，dist/ 已构建，当前 public/ 仍为默认前端（备用）

## 关键文件位置

- 路由：`routes/meetings/`（core/report/email/helpers）、`routes/glossary.js`
- 服务层：`services/`（meeting-store/glossary-store/s3/bedrock/gpu-autoscale）
- Workers：`workers/`（transcription/report/export + email-templates/）
- 测试：`tests/`（Jest 454 passed）、`e2e/`（Playwright 8 passed + 新增 edit.spec.js）
- 规范：`.claude/rules/`（api/coding/testing/data/vue）
- Spec：`.spec/features/unified-edit-ux.md`
- Vue 组件：`src/components/`（common/meeting/upload）、`src/views/`（Home/Meeting/Glossary）
