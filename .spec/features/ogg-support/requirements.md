# OGG Format Support — Requirements

## 概述
前端上传过滤器、后端 MIME 白名单、文件后缀验证三处同时加入 OGG 格式支持。

## 功能需求

### FR-1：前端上传支持 OGG
- `public/index.html` 的文件上传 `accept` 属性加入 `.ogg`。
- `public/js/app.js` 的 `uploadFile()` 前端校验加入 `audio/ogg` MIME 类型和 `.ogg` 后缀。
- 上传区域提示文字更新，包含 OGG 格式。

### FR-2：后端校验支持 OGG
- `routes/meetings.js` multer `fileFilter` 的 `allowedMimes` 加入 `audio/ogg` 和 `application/ogg`。
- `allowedExts` 加入 `.ogg`。

### FR-3：转录兼容
- FunASR 原生支持 OGG 格式，无需额外处理。

## 非功能需求
- 变更范围极小，仅涉及白名单配置，无架构影响。
