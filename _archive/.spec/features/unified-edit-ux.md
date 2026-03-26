# Meeting Detail Page — 统一编辑交互 Spec v1.0

## 目标
重构 meeting.html 详情页所有编辑功能，统一为「行级展开编辑」模式，
覆盖 PC + 移动端，适配所有会议类型（general / weekly / merged）。

## 核心交互规则

### 1. 操作按钮位置
- PC：hover 到每一行时，行末出现 ✏️ 🗑 两个图标
- 移动端：图标常驻（不依赖 hover），尺寸 ≥ 36px
- 样式：透明背景，橙色图标，hover 时橙色背景白色图标

### 2. 编辑流程
1. 点 ✏️ → 该行就地展开为表单（inline，不弹窗）
2. 表单：橙色边框 input/textarea
3. 底部：[取消] [💾 保存]
   - 移动端：两个按钮全宽各占一半，高度 44px
   - PC：按钮靠右
4. 保存 → PATCH API → 收起更新

### 3. 新增
- 模块卡片标题右上角「＋」按钮
- 点击 → 列表底部展开空白表单

### 4. 删除
- 点击 🗑 → 弹出确认对话框（自定义轻量弹窗，AWS 黑底橙色风格）
- 用户点「确认删除」才执行，点「取消」关闭弹窗

### 5. CSS 规范
- 统一 class：.editable-row / .edit-form-inline / .edit-actions
- 不堆积 inline style，不用 !important
- 移动端断点：max-width: 640px

---

## 字段编辑器映射

### 通用字段
| 字段 | 编辑器 | 子字段 |
|------|--------|--------|
| summary | textarea | - |
| participants | 列表单行 | name |
| actions / actionItems | 表格行展开 | task, owner, deadline, priority |
| decisions / keyDecisions | 列表单行 | content |

### Weekly 专属
| 字段 | 编辑器 | 子字段 |
|------|--------|--------|
| teamKPI | textarea | - |
| announcements | 列表展开 | title*, detail, owner |
| projectReviews[i].project | 单行 input | name |
| projectReviews[i].progress | textarea | - |
| projectReviews[i].highlights | 列表展开 | point*, detail |
| projectReviews[i].lowlights | 列表展开 | point*, detail |
| projectReviews[i].risks | 列表展开 | risk*, mitigation |
| projectReviews[i].followUps | 表格行展开 | task*, owner, deadline |

### General 专属
| 字段 | 编辑器 | 子字段 |
|------|--------|--------|
| agenda | 列表单行 | item |
| risks | 列表展开 | risk*, mitigation |
| nextMeeting | 单行 input | - |

*必填

---

## 实现要求

### 核心：两个通用渲染函数
1. `renderEditableList(containerId, items, config, meetingId, section, prIndex?)`
   - config: `{ fields: [{key, label, type, required}], addLabel }`
   - 渲染列表 + 统一操作按钮 + 新增入口
2. `renderEditableTable(containerId, rows, config, meetingId, section, prIndex?)`
   - 用于 actions / followUps 表格
   - 同样 config 驱动

### 统一保存
`saveSection(meetingId, section, data, prIndex?)` → PATCH /api/meetings/:id/report

### 事件委托
所有交互通过 data-action，不写内联事件

### 清理
删除旧的 ~30 个独立编辑函数，全部由两个通用函数替代

---

## 验收标准
1. PC hover 显示按钮，展开编辑，保存更新
2. 移动端（<640px）按钮常驻，保存按钮全宽
3. general / weekly / merged 所有字段均可编辑
4. 新增/删除正常
5. npm test 全绿
6. 无 inline style 堆积，无 !important 覆盖

## 不在本次范围
- 撤销/重做、批量编辑、拖拽排序
