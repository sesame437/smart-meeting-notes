# Speaker Rename — Requirements

## 概述
转录完成后，用户可在会议详情页看到识别到的说话人列表（SPEAKER_0、SPEAKER_1...），逐一填写真实姓名，保存后系统存储 speaker_map，重新调用 Bedrock（带真实姓名 hint）重新生成纪要。

## 用户故事
- 作为用户，我希望在会议详情页看到当前识别到的所有说话人标签，以便了解转录中有几位发言人。
- 作为用户，我希望为每个 SPEAKER_X 标签填写真实姓名，以便生成的纪要使用真实姓名而非编号。
- 作为用户，我希望保存说话人映射后系统自动重新生成纪要，以便获得更准确的会议记录。

## 功能需求

### FR-1：说话人列表展示
- 仅当会议转录文本中包含 `SPEAKER_` 标签时，详情页显示"说话人"编辑区块。
- 列表展示所有唯一的 SPEAKER_X 标签（从 DynamoDB 记录或 S3 转录文本中提取）。
- 若已有 speakerMap 数据，回显已填写的姓名。

### FR-2：说话人姓名编辑
- 每个 SPEAKER_X 旁显示一个文本输入框，可填写真实姓名。
- 输入框可为空（表示不替换该说话人标签）。
- 提供"保存"按钮，一次性提交所有映射。

### FR-3：后端存储 & 重新生成
- `PUT /api/meetings/:id/speaker-map` 接收 speakerMap JSON。
- 后端将 speakerMap 存入 DynamoDB 会议记录。
- 保存后自动触发纪要重新生成（调用 Bedrock，将 speakerMap 注入 prompt）。
- 重新生成期间，状态变为 `processing`，stage 变为 `generating`。
- 生成完成后走现有 export-worker 流程。

## 非功能需求
- speakerMap 字段为 DynamoDB Map 类型，无需迁移表结构（DynamoDB schema-free）。
- 重新生成不应影响原始转录文件（S3 中的转录结果不变）。
- 重新生成应复用现有 report-worker 逻辑，避免代码重复。

## 边界条件
- 会议状态不在 `reported` / `completed` 时不允许编辑说话人（转录未完成无数据）。
- speakerMap 最多支持 20 个说话人（前端限制）。
- 重复提交 speakerMap 时覆盖上次结果。
