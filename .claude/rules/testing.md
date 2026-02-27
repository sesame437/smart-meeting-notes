# 测试规范

## 覆盖率要求
- 新增代码：≥ 80% 行覆盖率
- routes/ 目录：每个路由至少 3 个测试（正常路径 + 边界 + 错误路径）
- workers/ 目录：核心逻辑必须有 mock 测试
- services/ 目录：S3/SQS/DynamoDB 操作必须有 mock 测试

## 覆盖率检查命令
```bash
npm test -- --coverage
# 输出报告中 Lines 列 ≥ 70%（整体），routes/ ≥ 80%
# 新增代码后覆盖率不得低于当前基线
```

## 测试类型区分
- **单元测试**（`__tests__/unit/`）：测试单个函数/service，全部 mock 外部依赖
- **集成测试**（`__tests__/integration/`）：测试路由 → service → DB 完整链路，用内存 DB
- 禁止在单元测试中发真实网络请求

## 测试文件组织
```
__tests__/
  unit/
    services/uploadService.test.js
    services/reportService.test.js
  integration/
    meetings.upload.test.js
    meetings.report.test.js
```

## 测试写法规范
```javascript
// ✅ GOOD：描述行为，不描述实现
describe("POST /api/meetings/upload", () => {
  it("returns 201 with meetingId when audio uploaded successfully", async () => {})
  it("returns 400 when no file attached", async () => {})
  it("returns 500 when S3 upload fails", async () => {})
})

// ❌ BAD：测试名含实现细节
it("calls s3.uploadFile with correct params", async () => {})
```

## Mock 规范
- AWS SDK（S3/DynamoDB/SQS/Bedrock）必须 mock，不得真实调用
- 用 jest.mock() 或 sinon，不用手写 stub
- 每个测试独立，不依赖执行顺序

## CI 规范
- 每次 commit 前必须本地跑 npm test
- 测试失败不得 push
- 当前测试套件：302 个测试，全部通过为基线

## 验证成功标准（官方最佳实践）
npm test 必须输出：
- meeting-minutes：`302 passed, 0 failed`（当前基线）
- 新增代码后基线只能增加，不能减少
- 有任何 failed 不得 commit，不得 push
