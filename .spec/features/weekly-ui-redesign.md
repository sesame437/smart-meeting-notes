# Feature Spec：周会 UI 重设计（左侧锚点导航）
创建时间：2026-03-02
状态：待执行（Speaker-glossary 完成后开始）

## 背景
weekly 类型会议内容长且分块多（teamKPI + 公告 + 5+个项目 × 4个子区块），全部展开是"信息墙"。
新方案：左侧固定锚点导航 + 项目默认折叠 + 内部 4-Tab 切换，快速定位按需展开。

## 技术方案

### 新增/修改文件
| 文件 | 变更类型 | 说明 |
|------|---------|------|
| src/components/meeting/WeeklySidebar.vue | 新增 | 左侧锚点导航，Scrollspy |
| src/components/meeting/TeamKPICard.vue | 新增 | 统计卡片（on-track/at-risk/completed） |
| src/components/meeting/ProjectAccordion.vue | 新增 | 单个项目折叠卡片 + 4-Tab |
| src/components/meeting/WeeklySection.vue | 重构 | 使用上述子组件，≤200行 |
| src/views/MeetingView.vue | 修改 | weekly 时加载 WeeklySidebar |

### 关键设计决策
| 决策 | 选择 | 原因 |
|------|------|------|
| 导航方式 | 左侧固定锚点 + Scrollspy | 适合长页面，一目了然 |
| 项目展开 | 默认折叠，点击展开 | 减少信息量，按需查看 |
| 移动端适配 | 左侧导航改顶部横向滚动Tab | 移动端无左侧空间 |
| Tab 实现 | 原生 CSS + Vue ref，不引入组件库 | 保持轻量，符合现有规范 |

## 验收标准
- [ ] weekly 详情页有左侧固定导航
- [ ] TeamKPI 数字卡片正确统计 on-track/at-risk/completed
- [ ] 项目列表默认折叠，标题行显示状态色点
- [ ] 项目展开后 4-Tab（亮点/低光/风险/跟进）切换正常
- [ ] Scrollspy：滚动时左侧导航自动高亮
- [ ] 移动端（<768px）左侧导航变为顶部横向滚动
- [ ] npm test ≥ 454，lint 0 warnings，build ✅

## Batch 拆分
### Batch 1：骨架组件（WeeklySidebar + TeamKPICard + ProjectAccordion）
1. WeeklySidebar.vue（锚点列表 + Scrollspy 逻辑）
2. TeamKPICard.vue（3个统计卡片）
3. ProjectAccordion.vue（折叠卡片 + 4-Tab）

### Batch 2：组装 + 移动端适配
1. WeeklySection.vue 重构，使用新子组件
2. MeetingView.vue 集成 WeeklySidebar
3. 移动端响应式（<768px 顶部横向Tab）
4. Scrollspy 实装（IntersectionObserver）
