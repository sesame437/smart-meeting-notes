# OGG Format Support — Design

## 变更点

### 1. `public/index.html` (line 47)
```diff
- <input type="file" id="upload-input" accept=".mp4,.mp3,.m4a">
+ <input type="file" id="upload-input" accept=".mp4,.mp3,.m4a,.ogg">
```

上传提示文字 (line 50):
```diff
- <p class="upload-hint">Supports MP4, MP3, M4A formats</p>
+ <p class="upload-hint">Supports MP4, MP3, M4A, OGG formats</p>
```

### 2. `public/js/app.js` — `uploadFile()` (line 307-309)
```diff
- const validTypes = ["video/mp4", "audio/mpeg", "audio/mp3", "audio/mp4", "video/quicktime"];
+ const validTypes = ["video/mp4", "audio/mpeg", "audio/mp3", "audio/mp4", "video/quicktime", "audio/ogg"];
  const ext = file.name.split(".").pop().toLowerCase();
- if (!validTypes.includes(file.type) && !["mp4", "mp3", "m4a"].includes(ext)) {
+ if (!validTypes.includes(file.type) && !["mp4", "mp3", "m4a", "ogg"].includes(ext)) {
```

错误提示更新：
```diff
- Toast.error("Please upload MP4 or MP3 files only.");
+ Toast.error("Please upload MP4, MP3, M4A, or OGG files only.");
```

### 3. `routes/meetings.js` — multer fileFilter (line 26-31)
现有代码**已包含** `audio/ogg` 和 `.ogg`：
```js
const allowedMimes = [
  "audio/mpeg", "audio/wav", "audio/mp4", "audio/x-m4a",
  "audio/ogg", "audio/webm", ...  // ← 已有
];
const allowedExts = [".mp3", ".wav", ".mp4", ".m4a", ".ogg", ...]; // ← 已有
```

后端**无需修改**。仅需补充 `application/ogg` MIME 类型到 allowedMimes（某些浏览器对 OGG 使用此 MIME）。

## 影响范围
- 仅修改前端 2 个文件 + 后端 1 处 MIME 补充
- 无数据模型变更、无 API 变更、无 worker 变更
