# 测试规范（对齐 DEV_MODE v3.0）

## 三层验证体系（cc 必须全部通过后才能 commit）

### Layer 1：单元测试
```bash
npm test
```
- 要求：454+ passed，0 failed
- 覆盖率：Statements ≥ 79%，不得下降
- 新增代码：routes/ ≥ 80%，workers/ 核心逻辑必须有 mock 测试

### Layer 2：API 集成冒烟
```bash
node server.js &
sleep 3
curl -sf localhost:3300/health | jq '.status == "ok"'
# 有改动的接口各跑一次 curl 验证
kill %1
```

### Layer 3：Playwright E2E
```bash
NODE_ENV=production npm run build
node server.js &
sleep 3
npx playwright test e2e/ --reporter=list
kill %1
```
- 配置：playwright.config.js，baseURL=http://localhost:3300，headless=true
- 必须带 `--no-sandbox --disable-setuid-sandbox`（EC2 环境）
- 截图保存：e2e/screenshots/<feature>-<timestamp>.png

---

## E2E 铁律

### 功能与测试同步提交
- 每个涉及前端改动的 Batch，**必须同步编写 e2e/<feature>.spec.js**
- 禁止：前端路由/组件改了，E2E 还用旧选择器/旧路径
- E2E 文件与功能代码**同一个 commit 提交**，不允许事后补

### skip 不算通过
- `test.skip` 是警告信号，不是"没问题"
- 有 skip 必须说明原因：数据问题还是选择器失效？
- 新功能对应的用例不允许 skip

### 截图要求
- 截图必须有真实数据（不能是空白/loading 状态）
- 路径规范：`e2e/screenshots/<page>-<feature>.png`

---

## 测试文件组织
```
e2e/
  home.spec.js         — 首页加载、会议列表
  meeting.spec.js      — 详情页、编辑功能
  glossary.spec.js     — 词库页
  upload.spec.js       — 上传流程（不测真实 AWS 调用）
  screenshots/         — 截图目录

__tests__/
  unit/
    services/          — S3/SES/SQS/Bedrock mock 测试
    workers/           — Worker 逻辑 mock 测试
  integration/
    meetings.*.test.js — 路由 → service 完整链路
```

---

## E2E 写法示例

```javascript
const { test, expect } = require("@playwright/test");

test.describe("首页", () => {
  test("正常加载，显示会议列表", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/会议纪要/);
    await page.screenshot({ path: "e2e/screenshots/home-list.png" });
  });

  test("Console 无 CSP/JS 错误", async ({ page }) => {
    const errors = [];
    page.on("console", msg => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    await page.goto("/");
    await page.waitForTimeout(1000);
    expect(errors.filter(e => e.includes("CSP") || e.includes("SyntaxError"))).toHaveLength(0);
  });
});
```

---

## 单元测试写法规范

```javascript
// ✅ 描述行为
describe("POST /api/meetings/upload", () => {
  it("returns 201 with meetingId when audio uploaded successfully")
  it("returns 400 when no file attached")
  it("returns 500 when S3 upload fails")
})

// ❌ 测试实现细节
it("calls s3.uploadFile with correct params")
```

- AWS SDK（S3/DynamoDB/SQS/Bedrock）必须 mock
- 每个测试独立，不依赖执行顺序

---

## 验收成功标准

| 层次 | 标准 |
|------|------|
| Unit | 454+ passed，0 failed，覆盖率 ≥ 79% |
| API | /health 返回 200 |
| E2E | 全 pass，0 failed（skip 须说明原因）|

**三层全通过才能：** commit → push → 汇报今朝
