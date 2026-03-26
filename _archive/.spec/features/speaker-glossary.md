# Feature Spec：Speaker 识别 × 词汇表人员打通
创建时间：2026-03-02
状态：执行中

## 背景
转录后识别出 SPEAKER_0/1/2，用户需要手动对应真实姓名。目前每次都要重新输入，没有记忆。
新方案：词汇表新增 category="人员" 分类，SpeakerMap 组件展示每个 SPEAKER 的发言要点摘要（帮助用户判断"这是谁"），输入框集成词汇表搜索，录入一次永久记忆。

## 技术方案

### 新增/修改文件
| 文件 | 变更类型 | 说明 |
|------|---------|------|
| routes/glossary.js | 修改 | category 字段已支持，无需改动 |
| services/bedrock.js 或 prompts | 修改 | 生成纪要时额外提取每个 SPEAKER top3 发言要点 |
| src/components/meeting/SpeakerMap.vue | 重构 | 显示 keypoints + 词汇表搜索输入框 |
| src/stores/glossary.js | 修改 | 新增 fetchPersonnel() 只查 category="人员" |
| src/views/GlossaryView.vue | 修改 | 新增 "术语/人员" tab 切换 |

### API 设计
- GET /api/glossary?category=人员 — 筛选人员分类（后端已支持或需加 query param）
- PUT /api/meetings/:id/speaker-names — 已有，保持不变

### 数据结构变更
speakerKeypoints 存入 meeting.content：
```json
{
  "speakerKeypoints": {
    "SPEAKER_0": ["提出Q3预算调整", "建议加快上线", "询问技术方案"],
    "SPEAKER_1": ["确认项目时间线", "提到客户反馈"]
  }
}
```
Bedrock prompt 新增：在生成纪要时同步提取每个 SPEAKER 的 top3 发言要点。

### 关键设计决策
| 决策 | 选择 | 原因 |
|------|------|------|
| keypoints 存储位置 | meeting.content.speakerKeypoints | 不改 DynamoDB schema，存 JSON |
| 词汇表人员筛选 | GET /api/glossary?category=人员 | 后端加 query param 过滤 |
| 已有会议的 keypoints | 显示"暂无发言摘要" | 不做回溯，新会议才有 |

## 验收标准
- [ ] GET /api/glossary?category=人员 只返回人员分类
- [ ] SpeakerMap 每个 SPEAKER 卡片显示 keypoints（无则显示"暂无摘要"）
- [ ] 输入框搜索词汇表人员，有下拉提示
- [ ] 保存后可一键存入词汇表（category="人员"）
- [ ] GlossaryView 有术语/人员 tab 切换
- [ ] npm test ≥ 454，lint 0 warnings，build ✅

## Batch 拆分
### Batch 1：后端（keypoints提取 + glossary category过滤）
1. routes/glossary.js 支持 ?category= query param 过滤
2. Bedrock prompt 新增 speakerKeypoints 提取（存入 content）
3. 补充相关单元测试

### Batch 2：前端（SpeakerMap重构 + GlossaryView人员tab）
1. SpeakerMap.vue 重构：每个 SPEAKER 卡片 + keypoints + 词汇表搜索输入框 + 一键存入词汇表
2. glossary store 新增 fetchPersonnel()
3. GlossaryView.vue 新增术语/人员 tab 切换
