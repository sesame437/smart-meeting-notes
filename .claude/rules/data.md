# 数据规范

## S3 Key 格式（铁律）
存入 DynamoDB 的 S3 Key 一律存裸 key（不带 PREFIX）

| 字段 | 格式示例 |
|------|---------|
| s3Key | inbox/{meetingId}/{filename} |
| reportKey | reports/{meetingId}/report.json |
| transcribeKey | transcripts/{meetingId}/transcribe.json |
| funasrKey | transcripts/{meetingId}/funasr.json |

- uploadFile(bareKey) 传裸 key，内部加 PREFIX
- getFile(bareKey) 传裸 key，内部加 PREFIX
- 业务代码不拼 PREFIX，不知道 PREFIX 的存在

## meetingId 格式
统一用 crypto.randomUUID()（UUID v4），禁止用 `meeting-${Date.now()}`

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
| content | Object | report JSON 副本（与 S3 同步） |
| speakerMap | Object | {label: realName} |
| duration | String | 时长 |
| errorMessage | String | 失败原因 |
| updatedAt | String | ISO 8601 UTC |
| emailSentAt | String | ISO 8601 UTC，null 表示未发 |

## Report JSON 完整结构（S3 存储 + DynamoDB.content）

### 通用字段（所有会议类型）
```json
{
  "summary": "2-3句话摘要",
  "participants": ["参会人1"],
  "highlights": [{ "point": "标题", "detail": "详情" }],
  "lowlights":  [{ "point": "标题", "detail": "详情" }],
  "actions":    [{ "task": "任务", "owner": "负责人", "deadline": "截止", "priority": "优先级" }],
  "decisions":  [{ "decision": "决策内容" }]
}
```

### weekly 额外字段
```json
{
  "teamKPI": {
    "summary": "KPI总结",
    "indicators": [{ "name": "成员", "kpi": "内容", "status": "completed|at-risk|normal" }]
  },
  "announcements": [{ "title": "标题", "detail": "详情", "owner": "发布人" }],
  "projectReviews": [{
    "project": "项目名",
    "progress": "进展",
    "highlights": [{ "point": "亮点", "detail": "详情" }],
    "lowlights":  [{ "point": "问题", "detail": "影响" }],
    "risks":      [{ "risk": "风险", "mitigation": "应对", "impact": "high|medium|low" }],
    "followUps":  [{ "task": "跟进", "owner": "负责人", "deadline": "截止", "status": "in-progress|done|blocked" }]
  }]
}
```

### tech/general 额外字段
```json
{
  "topics": [{ "topic": "议题", "discussion": "讨论要点", "conclusion": "结论" }]
}
```

### customer 额外字段
```json
{
  "customerInfo": { "name": "客户名", "industry": "行业" },
  "customerNeeds": ["需求1"],
  "painPoints":    ["痛点1"],
  "solutionsDiscussed": ["方案1"],
  "commitments":   [{ "item": "承诺", "owner": "负责人", "deadline": "截止" }],
  "nextSteps":     [{ "action": "下一步", "owner": "负责人", "deadline": "截止" }]
}
```

## ⚠️ 字段命名铁律（禁止使用旧别名）
| ✅ 正确 | ❌ 禁止（旧别名） |
|--------|----------------|
| actions | actionItems |
| decisions | keyDecisions / key_decisions |
| highlights[].point | highlights[].text |
| lowlights[].point | lowlights[].text |

前端直接用 `report.actions`，禁止写 `report.actions || report.actionItems` 双轨兜底。

## SQS 消息格式
```json
{ "meetingId": "uuid", "s3Key": "bare-key", "createdAt": "iso8601", "meetingType": "weekly" }
```

## Status 流转
pending → processing → transcribed → reported → done（任意失败 → failed + errorMessage）

## speakerMap
- Key：任意非空字符串（原始说话人 label）
- Value：真实姓名，最长 100 字符

## 日期格式
一律 ISO 8601 UTC：`"2026-02-27T15:30:00.000Z"`
