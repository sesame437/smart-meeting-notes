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
- S3 Event key 带 PREFIX，必须 strip 后再用

## meetingId 格式
- 统一用 crypto.randomUUID()（UUID v4 格式）
- 禁止用 `meeting-${Date.now()}` 等旧格式（历史数据保留，新数据不用）

## DynamoDB 主键
- PK: meetingId（UUID）
- SK: createdAt（ISO 8601，如 2026-02-26T11:33:20.979Z）
- 所有写操作必须带正确 createdAt，retry 时从消息体传入原始 createdAt

## SQS 消息格式
```typescript
// TranscriptionMessage
{ meetingId: string, s3Key: string, createdAt: string, meetingType?: string, isS3Event?: boolean }

// ExportMessage
{ meetingId: string, createdAt: string, meetingName?: string }
```

## Status 流转
pending → processing → transcribed → reported → done
任意步骤失败 → failed（同时写 errorMessage 字段）

## speakerMap 规范
- Key：任意非空字符串（原始说话人 label，如 "SPEAKER_01" 或 participant 描述）
- Value：真实姓名，最长 100 字符
- 存 DynamoDB，重新调用 Bedrock 时传入

## 日期格式规范
所有日期字段一律用 ISO 8601 UTC 格式存储和传输：
- ✅ 正确：`"2026-02-27T15:30:00.000Z"`
- ❌ 错误：时间戳数字、本地时间字符串、非标准格式
- DynamoDB 存字符串，不存数字时间戳
- API 响应中的日期字段同样遵守此格式
