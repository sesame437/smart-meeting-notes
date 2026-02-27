# API 设计规范

## URL 结构
- 资源用名词复数：/api/meetings, /api/meetings/:id
- 子资源：/api/meetings/:id/report, /api/meetings/:id/speaker-names
- 操作动词用 POST + 动词路径：/api/meetings/:id/regenerate, /api/meetings/:id/auto-name
- kebab-case URL，camelCase JSON 字段

## HTTP 方法语义
| 方法 | 幂等 | 用途 |
|------|------|------|
| GET | 是 | 查询，不修改数据 |
| POST | 否 | 创建资源、触发动作 |
| PUT | 是 | 全量替换 |
| PATCH | 否 | 部分更新 |
| DELETE | 是 | 删除 |

## Status Code 规范
- 200 OK：GET/PUT/PATCH 成功（有响应体）
- 201 Created：POST 创建成功（含 Location header）
- 204 No Content：DELETE 成功（无响应体）
- 400 Bad Request：参数错误/校验失败
- 404 Not Found：资源不存在
- 409 Conflict：状态冲突（如重复上传）
- 500 Internal Server Error：服务端未预期错误

## 错误响应格式（统一）
```json
{ "error": { "code": "MEETING_NOT_FOUND", "message": "会议不存在" } }
```
禁止直接返回 `{ "error": "string" }` 或裸 500 栈信息。

## 分页规范
- 列表接口必须支持分页：?limit=20&nextToken=xxx
- 响应包含：{ items: [], nextToken: "xxx" | null, total: N }
- 禁止返回全量数据（超过 100 条必须分页）

## Rate Limiting（已有，不要重复添加）
server.js 已配置 express-rate-limit 中间件：
- 全局限速：100 req / 15min per IP
- 上传接口：10 req / 15min per IP
禁止在路由层再次添加 rate-limit 逻辑，会产生双重限速。
