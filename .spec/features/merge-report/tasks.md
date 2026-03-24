# Merge Report — Tasks

## Batch 1：后端核心（无依赖）

- [ ] **1.1** `services/bedrock.js`：新增 `merged` meetingType 的 prompt 模板（含 customPrompt 注入）
- [ ] **1.2** `services/bedrock.js`：`invokeModel()` 增加 `customPrompt` 参数，传递给 `getMeetingPrompt()`
- [ ] **1.3** `routes/meetings.js`：新增 `POST /api/meetings/merge` endpoint — 校验 meetingIds、读取 DynamoDB 记录
- [ ] **1.4** `routes/meetings.js`：merge endpoint 内部 — 从 S3 读取各会议转录文本、合并、截断、调用 Bedrock、存 report、创建 DynamoDB 记录、发 export queue

**依赖：** 1.1 → 1.2 → 1.3 → 1.4 有顺序依赖

## Batch 2：前端列表页交互（依赖 Batch 1）

- [ ] **2.1** `public/js/app.js`：`meetingCard()` 中为 reported/completed 且非 merged 的会议添加复选框
- [ ] **2.2** `public/js/app.js`：实现复选框状态管理（selectedIds Set），监听 change 事件
- [ ] **2.3** `public/js/app.js` + `public/css/style.css`：实现浮动 action bar（已选数量 + 取消全选 + 合并生成按钮），勾选 >= 2 时显示
- [ ] **2.4** `public/js/app.js`：实现合并弹窗（已选会议列表 + customPrompt textarea + 生成/取消按钮）

**依赖：** Batch 1 全部完成；Batch 内 2.1 → 2.2 → 2.3 → 2.4 有顺序依赖

## Batch 3：前端详情页 + 列表标记（依赖 Batch 1）

- [ ] **3.1** `public/js/app.js`：`meetingCard()` 中为 merged 类型添加"Merged"标签 badge
- [ ] **3.2** `public/js/app.js`：`renderMeetingDetail()` 中当 meetingType="merged" 时，Summary 下方显示"源会议"卡片（parentIds → 会议链接列表）
- [ ] **3.3** `public/css/style.css`：merged badge 样式 + 源会议卡片样式
- [ ] **3.4** `public/index.html`：filter tabs 新增 "合并" 选项（data-filter="merged"）

**依赖：** Batch 1 全部完成；与 Batch 2 无依赖，可并行

## Batch 4：测试 + 边界处理（依赖 Batch 2 + 3）

- [ ] **4.1** API 测试：`POST /api/meetings/merge` 正常流程 + 错误场景（400/404/部分跳过）
- [ ] **4.2** 单元测试：merged prompt 模板输出验证
- [ ] **4.3** 集成测试：完整流程 — 勾选 → 弹窗 → 生成 → 列表出现 merged 记录 → 详情页展示源会议
