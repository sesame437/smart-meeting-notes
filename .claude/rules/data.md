# 数据规范（权威文件，所有数据结构以此为准）

## S3 Key 格式（铁律）
存入 DynamoDB 的 S3 Key 一律存裸 key（不带 PREFIX）

| 字段 | 格式示例 |
|------|---------|
| s3Key | inbox/{meetingId}/{filename} |
| reportKey | reports/{meetingId}/report.json |
| transcriptKey | transcripts/{meetingId}/transcribe.json |
| funasrKey | transcripts/{meetingId}/funasr.json |

- uploadFile(bareKey) / getFile(bareKey) 内部加 PREFIX，业务代码不感知 PREFIX

## meetingId 格式
统一用 crypto.randomUUID()（UUID v4），禁止 `meeting-${Date.now()}`

## DynamoDB 表结构
表名：`meeting-minutes-meetings`（PK: meetingId, SK: createdAt）

| 字段 | 类型 | 说明 |
|------|------|------|
| meetingId | String PK | UUID v4 |
| createdAt | String SK | ISO 8601 UTC |
| title | String | 会议标题 |
| meetingType | String | general/weekly/tech/customer/merged |
| status | String | pending/processing/transcribed/reported/done/failed |
| stage | String | transcribing/generating/exporting/done/failed |
| s3Key | String | 原始音频裸 key |
| reportKey | String | 报告 JSON 裸 key |
| transcriptKey | String | 转录文本裸 key |
| content | Object | report JSON 副本（与 S3 实时同步） |
| speakerMap | Object | {rawLabel: realName} |
| duration | String | 时长 |
| errorMessage | String | 失败原因 |
| updatedAt | String | ISO 8601 UTC |
| emailSentAt | String | ISO 8601 UTC，null 表示未发 |

## Report JSON 完整结构（S3 + DynamoDB.content 权威定义）

### 通用字段（所有类型均有）
```json
{
  "summary": "2-3句话摘要",
  "participants": ["参会人1", "参会人2"],
  "highlights": [{ "point": "亮点标题", "detail": "详情" }],
  "lowlights":  [{ "point": "问题标题", "detail": "影响" }],
  "actions":    [{ "task": "任务", "owner": "负责人", "deadline": "截止", "priority": "high|medium|low" }],
  "decisions":  [{ "decision": "决策内容", "rationale": "原因" }]
}
```

### weekly 额外字段
```json
{
  "teamKPI": {
    "overview": "KPI总体情况",
    "individuals": [{ "name": "成员", "kpi": "KPI要点", "status": "on-track|at-risk|completed" }]
  },
  "announcements": [{ "title": "标题", "detail": "内容", "owner": "发布人" }],
  "projectReviews": [{
    "project": "项目名",
    "progress": "本周进展",
    "highlights": [{ "point": "亮点", "detail": "详情" }],
    "lowlights":  [{ "point": "问题", "detail": "影响" }],
    "risks":      [{ "risk": "风险", "mitigation": "应对", "impact": "high|medium|low" }],
    "followUps":  [{ "task": "跟进事项", "owner": "负责人", "deadline": "截止", "status": "new|in-progress|blocked|done" }],
    "challenges": [{ "challenge": "挑战", "detail": "背景和当前状态" }]
  }],
  "nextMeeting": "下次会议时间（如有）"
}
```

### tech / general 额外字段
```json
{
  "topics": [{ "topic": "议题", "discussion": "讨论要点", "conclusion": "结论" }]
}
```

### customer 额外字段
```json
{
  "customerInfo": { "company": "客户公司", "attendees": ["客户参会人"] },
  "awsAttendees": ["AWS参会人"],
  "customerNeeds": [{ "need": "需求描述", "priority": "high|medium|low", "background": "背景" }],
  "painPoints":    [{ "point": "痛点", "detail": "详情" }],
  "solutionsDiscussed": [{ "solution": "方案", "awsServices": ["服务名"], "customerFeedback": "反馈" }],
  "commitments":   [{ "party": "AWS|客户", "commitment": "承诺", "owner": "负责人", "deadline": "截止" }],
  "nextSteps":     [{ "task": "下一步", "owner": "负责人", "deadline": "截止", "priority": "high|medium|low" }]
}
```

### merged 额外字段
```json
{
  "keyTopics":    [{ "topic": "主题", "detail": "分析", "source": "来源会议" }],
  "risks":        [{ "risk": "风险", "impact": "影响", "mitigation": "措施" }],
  "sourceMeetings": ["会议标题1", "会议标题2"]
}
```
注：merged 的 highlights/lowlights/actions/decisions 各条目额外含 `source` 字段。

## ⚠️ 字段命名铁律（禁止使用旧别名）
| ✅ 正确 | ❌ 禁止 | 说明 |
|--------|--------|------|
| actions | actionItems | PATCH API 和前端统一用 actions |
| decisions | keyDecisions / key_decisions | 统一用 decisions |
| highlights[].point | highlights[].text | Bedrock 输出是 point，不是 text |
| lowlights[].point | lowlights[].text | 同上 |
| teamKPI.individuals | teamKPI.indicators | Bedrock 和前端都用 individuals |

前端禁止写 `report.actions || report.actionItems` 双轨兜底，统一用 `report.actions`。
历史数据迁移兼容仅在 report-worker.js 读取时做一次性转换，不扩散到前端。

## SQS 消息格式
```json
{ "meetingId": "uuid", "s3Key": "bare-key", "createdAt": "iso8601", "meetingType": "weekly" }
```

## Status 流转
pending → processing → transcribed → reported → done
任意步骤失败 → failed（同时写 errorMessage 字段）

## speakerMap
- Key：原始说话人 label（任意非空字符串）
- Value：真实姓名，最长 100 字符

## 日期格式
一律 ISO 8601 UTC：`"2026-02-27T15:30:00.000Z"`

## DynamoDB 查询规范（重要）
- **禁止 ScanCommand** 用于列表接口，费用高且随数据量线性增长
- **listXxx() 标准做法**：对所有已知枚举值并行 QueryCommand，合并去重
  ```js
  // 示例：listMeetings() 按 status GSI 并行 Query
  const statuses = ["pending", "processing", "transcribed", "reported", "completed", "failed", "created"];
  const results = await Promise.all(statuses.map(status =>
    docClient.send(new QueryCommand({
      TableName: TABLE,
      IndexName: "status-createdAt-index",
      KeyConditionExpression: "#s = :s",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: { ":s": status },
    }))
  ));
  const items = results.flatMap(r => r.Items || []);
  // 去重 + 排序
  ```
- **例外**：数据量极小（< 100条）且无 GSI 的辅助表（如 glossary），可保留 Scan 并加注释说明原因
