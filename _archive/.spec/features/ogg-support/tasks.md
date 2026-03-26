# OGG Format Support — Tasks

## Batch 1：全部变更（无依赖，可并行）

- [ ] **1.1** `public/index.html`：`accept` 属性加 `.ogg`，提示文字加 OGG
- [ ] **1.2** `public/js/app.js`：`uploadFile()` 的 validTypes 加 `audio/ogg`，ext 白名单加 `ogg`，错误提示更新
- [ ] **1.3** `routes/meetings.js`：multer fileFilter 的 allowedMimes 加 `application/ogg`（`audio/ogg` 已存在）

**依赖：** 无。三项变更互不依赖，可并行完成。

## Batch 2：验证（依赖 Batch 1）

- [ ] **2.1** 手动测试：上传 .ogg 文件验证前端不拦截、后端不拦截、FunASR 正常转录
