# Speaker Rename — Design

## 架构概览

```
[前端 meeting.html]                [后端 routes/meetings.js]            [services/bedrock.js]
      │                                    │                                    │
      │  PUT /api/meetings/:id/speaker-map │                                    │
      ├───────────────────────────────────>│                                    │
      │  { speakerMap: {...} }             │                                    │
      │                                    │── 存 speakerMap 到 DynamoDB        │
      │                                    │── 读取转录文本 (S3)                │
      │                                    │── 注入 speakerMap 到 prompt ──────>│
      │                                    │                                    │── Bedrock 生成
      │                                    │<──────── 返回 report JSON ─────────│
      │                                    │── 存 report 到 S3                  │
      │                                    │── 更新 DynamoDB status             │
      │                                    │── 发 SQS 到 export queue           │
      │  200 OK                            │                                    │
      │<───────────────────────────────────│                                    │
```

## 数据模型变更

### DynamoDB `meeting-minutes-meetings` 表
新增字段（无需迁移，DynamoDB schema-free）：
```json
{
  "speakerMap": {
    "SPEAKER_0": "张三",
    "SPEAKER_1": "李四"
  }
}
```

## API 设计

### `PUT /api/meetings/:id/speaker-map`
**Request:**
```json
{
  "speakerMap": {
    "SPEAKER_0": "张三",
    "SPEAKER_1": "李四"
  }
}
```

**Response (200):**
```json
{
  "success": true,
  "meetingId": "xxx",
  "status": "processing"
}
```

**错误场景:**
- 404: 会议不存在
- 400: speakerMap 格式错误或为空对象
- 409: 会议当前正在处理中，不允许重复提交

**流程：**
1. 校验 speakerMap（非空对象，key 均为 `SPEAKER_\d+` 格式，value 为非空字符串）
2. 更新 DynamoDB：存 speakerMap，status → `processing`，stage → `generating`
3. 从 S3 读取转录文本（使用现有的 `funasrKey` 或 `transcribeKey`）
4. 调用 `invokeModel()` 生成新报告（speakerMap 作为额外 prompt 参数）
5. 上传新 report.json 到 S3（覆盖旧的）
6. 更新 DynamoDB：status → `reported`，stage → `exporting`
7. 发消息到 export queue（走现有邮件发送流程）

## services/bedrock.js 变更

### `getMeetingPrompt` 增加 speakerMap 参数
```js
function getMeetingPrompt(transcriptText, meetingType, glossaryTerms = [], speakerMap = {}) {
  // 当有 speakerMap 时，替换 speakerNote
  const speakerMapEntries = Object.entries(speakerMap).filter(([_, v]) => v);
  if (speakerMapEntries.length > 0) {
    speakerNote = `转录文本中的说话人标签对应真实姓名如下：\n${
      speakerMapEntries.map(([k, v]) => `${k} = ${v}`).join('\n')
    }\n请在纪要中直接使用真实姓名。\n\n`;
  }
  // 原有逻辑不变...
}
```

### `invokeModel` 增加 speakerMap 参数
```js
async function invokeModel(transcriptText, meetingType, glossaryTerms, modelId, speakerMap) {
  // 传递 speakerMap 给 getMeetingPrompt
}
```

## 前端设计

### meeting.html 详情页 — 说话人编辑区块
位置：Summary card 下方，仅当转录包含 `SPEAKER_` 标签时显示。

```
┌─────────────────────────────────────────┐
│ 👤 说话人识别                            │
│                                         │
│  SPEAKER_0  [张三          ]            │
│  SPEAKER_1  [李四          ]            │
│  SPEAKER_2  [              ]            │
│                                         │
│              [💾 保存并重新生成纪要]       │
└─────────────────────────────────────────┘
```

### 实现位置
- `public/js/app.js` 的 `renderMeetingDetail()` 函数中，Summary card 后插入说话人区块。
- 从 meeting 数据中提取 speakerMap（已保存的）和 speakers（从 report 或转录提取）。

### 说话人提取逻辑
从会议记录的 `content` 或通过后端 API 获取。前端检测方式：
- 检查 meeting.status 是否为 `reported` 或 `completed`
- 检查 meeting 数据中是否存在 speakers 列表或 speakerMap

## 关键决策
1. **重新生成在 API endpoint 内同步执行**（非通过 SQS 排队），因为用户操作是即时的，不需要排队等待。仅 export 阶段走 SQS。
2. **不修改原始转录文件**，speakerMap 仅作为 prompt hint 注入，让 Bedrock 使用真实姓名。
3. **speaker 列表从转录文本解析**，后端在转录完成时将检测到的 speakers 存入 DynamoDB。
