# Merge Report — Design

## 架构概览

```
[前端 index.html]                    [后端 routes/meetings.js]           [services/bedrock.js]
      │                                      │                                  │
      │ 勾选会议 → 弹窗 → 填写 prompt         │                                  │
      │                                      │                                  │
      │ POST /api/meetings/merge             │                                  │
      │ { meetingIds, customPrompt }         │                                  │
      ├─────────────────────────────────────>│                                  │
      │                                      │── 查询各会议 DynamoDB 记录         │
      │                                      │── 从 S3 读取各会议转录文本          │
      │                                      │── 合并文本 + 注入 customPrompt     │
      │                                      │── 调用 Bedrock ─────────────────>│
      │                                      │                                  │── 生成汇总报告
      │                                      │<──────── 返回 report JSON ───────│
      │                                      │── 创建 merged 会议 DynamoDB 记录   │
      │                                      │── 存 report 到 S3                 │
      │                                      │── 发 SQS 到 export queue          │
      │ 201 { meetingId, status }            │                                  │
      │<─────────────────────────────────────│                                  │
```

## 数据模型

### 合并会议 DynamoDB 记录
```json
{
  "meetingId": "merged-uuid",
  "meetingType": "merged",
  "title": "合并报告 — 2026-02-26",
  "parentIds": ["meeting-id-1", "meeting-id-2", "meeting-id-3"],
  "customPrompt": "总结本周所有项目进展",
  "status": "processing",
  "stage": "generating",
  "createdAt": "2026-02-26T10:00:00Z"
}
```

## API 设计

### `POST /api/meetings/merge`

**Request:**
```json
{
  "meetingIds": ["id1", "id2", "id3"],
  "customPrompt": "总结本周所有项目进展"
}
```

**Response (201):**
```json
{
  "meetingId": "merged-xxx",
  "status": "processing",
  "skipped": []
}
```

**Response (201, 部分跳过):**
```json
{
  "meetingId": "merged-xxx",
  "status": "processing",
  "skipped": [{ "meetingId": "id3", "reason": "无转录文件" }]
}
```

**错误场景:**
- 400: meetingIds 为空或少于 2 个
- 400: meetingIds 超过 10 个
- 400: 所有会议均无转录文件
- 404: 某个 meetingId 不存在

**处理流程：**
1. 校验 meetingIds（2-10 个，均存在，均为 reported/completed）
2. 批量读取各会议的 DynamoDB 记录，获取 S3 转录文件 key
3. 从 S3 读取各会议转录文本（并行，使用 Promise.allSettled）
4. 合并转录文本，格式：
   ```
   === 会议 1: {title} ({date}) ===
   {transcript_1}

   === 会议 2: {title} ({date}) ===
   {transcript_2}
   ...
   ```
5. 截断合并文本（复用 truncateTranscript，上限 120000 字符）
6. 构建 merged prompt，注入 customPrompt
7. 调用 Bedrock 生成汇总报告
8. 创建新 DynamoDB 记录（meetingType: "merged"）
9. 上传 report.json 到 S3
10. 发消息到 export queue

## services/bedrock.js 变更

### 新增 `merged` meetingType prompt 模板
```js
if (meetingType === "merged") {
  const customNote = customPrompt
    ? `用户自定义要求：${customPrompt}\n\n`
    : "";
  return `${customNote}${glossaryNote}你是专业会议纪要助手。以下是多个会议的转录文本合集，请生成一份综合汇总报告。

转录文本：
${transcriptText}

以 JSON 格式输出：
{
  "meetingType": "merged",
  "summary": "跨会议综合总结（3-5句话）",
  "keyFindings": [{ "finding": "重要发现", "source": "来源会议", "detail": "详情" }],
  "crossMeetingThemes": [{ "theme": "跨会议主题", "detail": "分析" }],
  "actions": [{ "task": "行动项", "owner": "负责人", "deadline": "截止日期", "priority": "high/medium/low", "source": "来源会议" }],
  "decisions": [{ "decision": "决策", "rationale": "原因", "source": "来源会议" }],
  "risks": [{ "risk": "风险", "impact": "影响", "mitigation": "措施" }],
  "sourceMeetings": ["会议标题列表"]
}
只输出 JSON。`;
}
```

### `invokeModel` 增加 customPrompt 参数
```js
async function invokeModel(transcriptText, meetingType, glossaryTerms, modelId, speakerMap, customPrompt)
```

## 前端设计

### index.html — 复选框 + Action Bar

#### 复选框
在 `meetingCard()` 中，仅 `reported` / `completed` 且非 `merged` 类型的会议行前增加复选框：
```html
<input type="checkbox" class="merge-checkbox" data-id="{meetingId}" />
```

#### 浮动 Action Bar
```
┌──────────────────────────────────────────────────────────┐
│  已选 3 个会议    [取消全选]    [📋 合并生成报告]           │
└──────────────────────────────────────────────────────────┘
```
- 固定底部，勾选 >= 2 时显示
- CSS: `position: fixed; bottom: 0; ...`

#### 模态对话框
```
┌─────────────────────────────────────┐
│ 合并生成报告                          │
│                                     │
│ 已选会议：                            │
│  • 周例会 2026-02-24                 │
│  • 客户会议 - ABC公司                 │
│  • 技术评审 - 架构方案                 │
│                                     │
│ 自定义提示词（可选）：                  │
│ ┌─────────────────────────────────┐ │
│ │ 总结本周所有项目进展              │ │
│ └─────────────────────────────────┘ │
│                                     │
│         [取消]    [生成报告]          │
└─────────────────────────────────────┘
```

### meeting.html — 合并报告详情

在 `renderMeetingDetail()` 中：
- 当 `meetingType === "merged"` 时，Summary 下方显示"源会议"卡片
- 列出 parentIds 对应的会议链接

## 关键决策
1. **合并生成在 API 内同步执行**（与 speaker-rename 一致），因为用户期望即时反馈。转录文本已存在于 S3，只需读取合并后调用 Bedrock。
2. **合并报告作为独立 DynamoDB 记录**，meetingType="merged"，通过 parentIds 关联源会议。
3. **merged 类型的会议不可被再次合并**，防止无限嵌套。
4. **customPrompt 注入 Bedrock prompt 顶部**，作为优先指令。
