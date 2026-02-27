# 测试规范

## 覆盖率要求
- 新增代码：≥ 80% 行覆盖率
- routes/ 目录：每个路由至少 3 个测试（正常路径 + 边界 + 错误路径）
- workers/ 目录：核心逻辑必须有 mock 测试
- services/ 目录：S3/SQS/DynamoDB 操作必须有 mock 测试

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
