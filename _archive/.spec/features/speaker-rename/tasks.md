# Speaker Rename — Tasks

## Batch 1：后端数据层 + API（无依赖）

- [ ] **1.1** `services/bedrock.js`：`getMeetingPrompt()` 增加 `speakerMap` 参数，当 speakerMap 非空时用真实姓名替换 speakerNote
- [ ] **1.2** `services/bedrock.js`：`invokeModel()` 增加 `speakerMap` 参数并透传给 `getMeetingPrompt()`
- [ ] **1.3** `routes/meetings.js`：新增 `PUT /api/meetings/:id/speaker-map` endpoint（校验 + 存 speakerMap + 调 Bedrock 重新生成 + 存 report + 发 export queue）
- [ ] **1.4** `workers/transcription-worker.js`：转录完成后解析 speakers 列表存入 DynamoDB（`speakers: ["SPEAKER_0", "SPEAKER_1", ...]`）

**依赖：** 无外部依赖，Batch 内 1.1 → 1.2 → 1.3 有顺序依赖；1.4 独立

## Batch 2：前端展示 + 交互（依赖 Batch 1）

- [ ] **2.1** `public/js/app.js`：`renderMeetingDetail()` 中 Summary 下方插入说话人编辑区块（仅当 meeting.speakers 存在时显示）
- [ ] **2.2** `public/js/app.js`：实现 `saveSpeakerMap(meetingId)` 函数，收集输入框值 → `PUT /api/meetings/:id/speaker-map`
- [ ] **2.3** `public/css/style.css`：说话人编辑区块样式（与现有 card 风格一致）
- [ ] **2.4** 保存后 UI 反馈：显示 loading 状态，成功后刷新详情页

**依赖：** Batch 1 全部完成

## Batch 3：测试 + 边界处理（依赖 Batch 2）

- [ ] **3.1** 单元测试：`getMeetingPrompt()` 带 speakerMap 参数的 prompt 输出验证
- [ ] **3.2** API 测试：`PUT /api/meetings/:id/speaker-map` 正常流程 + 错误场景（404/400/409）
- [ ] **3.3** 集成测试：完整流程 — 上传 → 转录 → 编辑说话人 → 重新生成 → 验证报告内容
