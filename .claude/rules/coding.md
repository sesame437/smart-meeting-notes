# 编码规范

## 命名规范
```javascript
// ✅ GOOD
const meetingId = req.params.id
async function fetchMeetingById(meetingId) {}
const isTranscriptionComplete = status === "transcribed"

// ❌ BAD
const id = req.params.id
async function getData(id) {}
const flag = status === "transcribed"
```

## 错误处理
```javascript
// ✅ GOOD
router.post("/upload", async (req, res) => {
  try {
    const result = await uploadService.upload(req.file)
    res.status(201).json({ meetingId: result.id })
  } catch (err) {
    logger.error("upload failed", { error: err.message })
    res.status(500).json({ error: { code: "UPLOAD_FAILED", message: err.message } })
  }
})

// ❌ BAD：裸 throw 不捕获、或直接 res.send(err)
```

## 不可变性
```javascript
// ✅ GOOD
const updated = { ...item, status: "done", updatedAt: new Date().toISOString() }

// ❌ BAD
item.status = "done"
```

## 日志规范
- 统一用 logger.js（services/logger.js）
- 禁止 console.log / console.error 在路由和 worker 中
- 日志必须含 module 字段：logger.info("msg", { module: "upload", meetingId })

## 路由文件规范
- 每个路由文件 ≤ 500 行
- 超过则按功能拆分子文件（参考 routes/meetings/ 目录结构）
- 复杂业务逻辑提取到 services/，路由只做参数校验 + 调用 + 响应
