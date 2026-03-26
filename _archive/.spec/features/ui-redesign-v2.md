# Feature Spec：会议纪要 UI 全面重设计
创建时间：2026-03-07
状态：待批准

---

## 一、配色系统

| 变量 | 颜色 | 用途 |
|------|------|------|
| `--bg` | `#f5f4f0` | 页面背景（暖白） |
| `--sidebar` | `#ffffff` | 左侧栏背景 |
| `--surface` | `#ffffff` | 卡片/面板 |
| `--masthead` | `#1a1a1a` | 顶栏（保留深色，品牌感） |
| `--border` | `#e4e3de` | 边框/分割线 |
| `--teal` | `#0a7c6a` | 周会 badge |
| `--blue` | `#1a45b0` | 技术 badge |
| `--red` | `#c41c1c` | 客户 badge |
| `--gold` | `#b87b14` | 处理中状态 |

字体：`Playfair Display`（标题） + `IBM Plex Sans`（正文） + `IBM Plex Mono`（数字/元信息）

---

## 二、三大页面改动说明

### 1. 首页（index.html）
**布局**：顶栏（黑色品牌栏）+ 规则栏 + 左侧导航 + 主内容区

**左侧导航**（白色，非深色）：
- 搜索框
- 会议类型筛选（全部 / 周会 / 技术讨论 / 客户会议）
- 状态筛选（已完成 / 处理中）
- 时间范围（本月 / 上月）
- 激活项：左边框 2px 黑色 + 浅灰背景

**主内容**：
- 4格统计条（本月会议 / 处理中 / 总时长 / Action Items）
- 处理中会议横幅（金色，带进度条）
- 会议列表：编辑杂志风，左侧大日期 + 右侧标题/摘要/actions

---

### 2. 详情页（meeting.html）

**顶部 Hero 区（无 badge 分类）**：
- 大标题（Playfair Display）
- 右侧两个按钮：`✏️ 改名` + `✨ 自动生成名称`
- 元信息行：日期 / 时长 / 参会人数 / 转录方式 / 完成状态
- 操作栏：发邮件 / 导出 PDF / 重新生成报告 / 删除

**主内容两栏**：
- 左（宽）：会议摘要 / Action Items（带勾选 + 优先级 tag + 负责人） / 关键决策
- 右（窄 300px）：参与者列表（含 Speaker 改名功能）/ 转录片段

**关键交互**：
- Action Items 勾选框：前端状态管理，勾选后划线+变色
- 会议摘要/各 section：右上角 ✏️ 编辑按钮，与现有 editSection() 对接
- 标题改名：对接现有 startDetailEdit() + saveDetailEdit()
- 自动命名：对接现有 `/api/meetings/:id/auto-name` 接口
- Speaker 改名：对接现有 saveSpeakerMap() + `/api/meetings/:id/speaker-names`

---

### 3. 词汇表（glossary.html）
**布局**：同首页，左侧导航白色

**左侧导航**：
- 搜索框
- 分类：全部 / 技术术语 / 业务词汇 / 人员 / 组织
- 来源：AI 提取 / 手动添加

**主内容**：
- 分类 Tab（全部/技术/业务/人员）
- 搜索 + 添加词条 按钮
- 字母索引快速跳转
- 表格：词条名（中/英）/ 释义 / 分类 badge / 来源会议 / 编辑·删除操作

**关键交互**：
- 添加词条：对接现有添加接口
- 编辑/删除：对接现有 glossary API
- 来源会议：点击跳转到对应详情页

---

## 三、功能对接清单（不改后端 API）

| 功能 | 前端函数 | API | 新 UI 位置 |
|------|----------|-----|-----------|
| 会议列表 | `fetchMeetings()` | `GET /api/meetings` | 首页列表 |
| 筛选/搜索 | `renderFilteredMeetings()` | 前端过滤 | 左侧栏 |
| 上传录音 | `initUpload()` | `POST /api/meetings/upload` | 顶栏按钮→弹窗 |
| 修改标题/类型 | `saveCardEdit()` | `PUT /api/meetings/:id` | 首页卡片✏️ |
| 自动命名 | `autoNameMeeting()` | `POST /api/meetings/:id/auto-name` | 详情页 ✨ 按钮 |
| 详情页标题编辑 | `saveDetailEdit()` | `PUT /api/meetings/:id` | 详情页 ✏️ 改名 |
| Section 编辑 | `saveSection()` | `PATCH /api/meetings/:id/report` | 各 section ✏️ |
| Speaker 改名 | `saveSpeakerMap()` | `PUT /api/meetings/:id/speaker-names` | 右侧参与者栏 |
| 参与者编辑 | `editParticipant()` | patch report | 右侧参与者栏 |
| 删除会议 | `deleteMeeting()` | `DELETE /api/meetings/:id` | 详情页危险区 |
| 重新生成 | `retryMeetingDetail()` | `POST /api/meetings/:id/retry` | 详情页操作栏 |
| 发邮件 | 现有逻辑 | `POST /api/meetings/:id/email` | 详情页操作栏 |
| 词汇表列表 | `fetchGlossary()` | `GET /api/glossary` | 词汇表页 |
| 词汇表搜索 | `filterGlossary()` | 前端过滤 | 词汇表搜索框 |
| 词汇表增删改 | 现有函数 | glossary CRUD API | 词汇表表格 |

---

## 四、Batch 拆分

### Batch 1：CSS 变量体系 + 首页重写
1. 新建 `public/css/style-v2.css`，定义配色变量 + 排版体系
2. 重写 `index.html`：新布局 + 左侧白色导航 + 杂志风列表
3. 保留 `app.js` 所有逻辑不动，只改 DOM 结构和 class 名

### Batch 2：详情页重写
1. 重写 `meeting.html`：Hero 区（无 badge）+ 两栏内容
2. 对接所有现有 JS 交互（标题改名、section 编辑、speaker 改名）
3. 右侧参与者 + 转录片段区布局

### Batch 3：词汇表页 + 移动端响应式
1. 重写 `glossary.html`：Tab + 字母索引 + 表格布局
2. 全站移动端适配（左侧栏收起为底部 Tab Bar，≤768px）

### Batch 4：验收
1. 全流程功能测试（上传→处理→详情→编辑→发邮件）
2. 更新 Jest 测试中的 selector（如有 DOM 测试）
3. git push + PROGRESS.md 更新

---

## 五、目录结构（并行预览，不替换现有版本）

新版前端放在 `public/v2/` 子目录下：
```
public/
├── index.html          ← 现有版本，不动
├── meeting.html        ← 现有版本，不动
├── glossary.html       ← 现有版本，不动
├── js/app.js           ← 现有 JS，不动
├── css/style.css       ← 现有样式，不动
└── v2/
    ├── index.html      ← 新版首页
    ├── meeting.html    ← 新版详情页
    ├── glossary.html   ← 新版词汇表
    ├── css/
    │   └── style-v2.css
    └── js/
        └── app-v2.js   ← 从 ../js/app.js 复制，调整路径引用
```

访问方式：
- 旧版：`http://localhost:3300/`
- 新版预览：`http://localhost:3300/v2/`

server.js 不需要改动，express.static 自动处理 /v2/ 路径。

app-v2.js 里的 API 调用路径不变（仍指向 `/api/...`），只改 DOM 选择器和 class 名以匹配新 HTML 结构。

## 六、不改动的内容
- 所有后端路由和 API（`routes/`、`server.js`）
- `public/` 下现有的 index.html / meeting.html / glossary.html / app.js / style.css
- DynamoDB schema
- Worker 逻辑

---

## 验收标准
- [ ] 三页面在 1440px 桌面端视觉效果符合 mockup
- [ ] 所有现有功能（上传、编辑、改名、发邮件、删除）在新 UI 中正常工作
- [ ] 移动端（375px）三页面可用，无水平溢出
- [ ] npm test（Jest）全部通过，覆盖率不降低
- [ ] Playwright E2E 核心流程通过
