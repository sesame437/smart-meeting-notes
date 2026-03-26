# Spec: routes/meetings.js 拆分

## 背景
routes/meetings.js 目前 899 行，违反单一职责原则。
14 个路由混在一起，维护困难，新功能容易互相干扰。

## 拆分方案

按业务领域拆成 4 个文件：

### routes/meetings/index.js（主入口，只做路由注册）
- 负责 require 各子模块并挂载到 router
- 约 30 行

### routes/meetings/core.js（核心 CRUD）
以下路由：
- GET  /                → 列表
- POST /               → 创建
- GET  /:id            → 详情
- PUT  /:id            → 更新
- DELETE /:id          → 删除
- POST /upload         → 上传音频
- POST /:id/retry      → 重试转录

### routes/meetings/report.js（报告生成相关）
以下路由：
- POST /merge          → 合并多个会议
- POST /:id/regenerate → 重新生成报告
- PUT  /:id/speaker-map → 说话人映射
- PATCH /:id/report    → 内联编辑报告区块
- PUT  /:id/speaker-names → 说话人重命名
- POST /:id/auto-name  → 自动命名

### routes/meetings/email.js（邮件相关）
以下路由：
- POST /:id/send-email → 发送邮件

## 共享依赖处理
meetings.js 顶部的 require（db/s3/sqs/bedrock 等）需要在各子文件里分别 require。
公共 helper 函数（如 streamToString、getItem 等）提取到 routes/meetings/helpers.js。

## server.js 变更
```js
// 改前
const meetingsRouter = require("./routes/meetings");
// 改后
const meetingsRouter = require("./routes/meetings/index");
```

## 验收标准
- [ ] 所有原有路由功能不变
- [ ] npm test 302 个全通过
- [ ] 每个文件 ≤ 300 行
- [ ] node --check routes/meetings/*.js
- [ ] git commit
