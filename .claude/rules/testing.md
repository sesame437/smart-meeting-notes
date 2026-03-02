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

## E2E 测试（Playwright）
- 测试文件放 `e2e/` 目录，文件名 `*.spec.js`
- 运行命令：`npm run test:e2e`（等价于 `playwright test`）
- 配置文件：`playwright.config.js`，baseURL=http://localhost:3300，headless=true，必须带 `--no-sandbox --disable-setuid-sandbox`（EC2 环境）
- **测什么**：核心用户流程（页面加载、导航、表单存在、关键 UI 元素）；不测外部服务（S3/SES/Bedrock）
- **不测什么**：真实文件上传、真实邮件发送、需要 AWS 调用的完整流程
- 依赖数据库数据的测试用 `test.skip` 条件跳过（CI 环境无数据属正常）
- 当前基线：**8 passed，2 skipped**（report.spec.js 依赖现有会议数据）

### E2E 测试写法示例
```javascript
const { test, expect } = require("@playwright/test");

test.describe("词库页", () => {
  test("词库页加载，标题正确", async ({ page }) => {
    await page.goto("/?tab=glossary");
    await expect(page).toHaveTitle(/会议纪要/);
  });

  test("添加术语表单存在", async ({ page }) => {
    await page.goto("/?tab=glossary");
    await expect(page.locator("#glossary-term-input")).toBeVisible();
  });
});
```

## CI 规范
- 每次 commit 前必须本地跑 `npm test`（unit）+ `npm run test:e2e`（e2e）
- Full Gate = lint + unit test（`bash scripts/health-check.sh`）
- 测试失败不得 push
- 当前测试套件基线：**432 unit + 8 e2e，全部通过**

## 验证成功标准
- unit：`432 passed, 0 failed`（基线只能增加）
- e2e：`8 passed, 2 skipped`（skipped 属正常，failed 才是问题）
- 覆盖率：Statements ≥ 79%，不得下降
- 有任何 failed 不得 commit，不得 push

---

## E2E 测试同步规范（2026-03-03 新增）

### 铁律：功能代码与 E2E 测试必须同步提交

**禁止：** 前端路由/组件/交互改了，E2E 还用旧选择器/旧路径
**要求：** 每个涉及前端改动的 Batch，AGENT PROMPT 必须包含：
- 新功能对应的 E2E 用例（新增或更新）
- 运行 `npm run test:e2e` 并截图验证（截图必须能看到真实数据）

### Agent Prompt E2E 验收模板（强制）
```
Batch N 完成条件（前端改动时）：
1. npm run build 通过
2. npm test ≥ N passed
3. npm run lint 0 warnings
4. npm run test:e2e —— 新功能必须有对应用例，pass 数不得少于上一 Batch
5. 截图验证：对所有改动的页面截图，保存到 /tmp/e2e-<page>.png，截图必须有真实数据（不能是空白/loading 状态）
```

### 今朝验收 checklist（agent 完成后必须执行）
- [ ] 跑 `npm run test:e2e`，确认 pass 数
- [ ] Playwright 截图所有改动页面，确认有真实数据
- [ ] 无 console error
- [ ] API 返回正常（不是空数组/404）
- [ ] 功能可以实际操作（不只是页面能打开）
- [ ] 全部通过后才汇报给凯

### skip 不算通过
- E2E 测试 skip 是警告信号，不是"没问题"
- skip 的原因必须检查：是数据问题还是选择器失效？
- 新功能对应的用例不允许 skip
