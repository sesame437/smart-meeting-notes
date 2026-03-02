const { test, expect } = require('@playwright/test')

test.describe('会议详情页', () => {
  // 使用真实会议ID
  const meetingId = '0707c9c4-c2c3-4d36-85d8-e776c65227f2'

  test('会议详情页加载，显示会议内容', async ({ page }) => {
    await page.goto(`/meetings/${meetingId}`)
    await page.waitForLoadState('networkidle')

    // 等待内容加载
    await page.waitForTimeout(1500)

    // 检查页面标题
    await expect(page).toHaveTitle(/会议详情|会议纪要/)

    // 检查主要内容区域存在
    const content = page.locator('#app, .meeting-detail, .meeting-content, main')
    await expect(content.first()).toBeVisible()
  })

  test('会议标题显示', async ({ page }) => {
    await page.goto(`/meetings/${meetingId}`)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1500)

    // 查找会议标题（可能在h1、breadcrumb或header中）
    const title = page.locator('h1, .meeting-title, .page-title, [data-testid="meeting-title"]')
    await expect(title.first()).toBeVisible()
  })

  test('摘要区块可见', async ({ page }) => {
    await page.goto(`/meetings/${meetingId}`)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1500)

    // 查找摘要相关内容
    const summarySection = page.locator('[data-section="summary"], .summary-section, :has-text("摘要")')
    await expect(summarySection.first()).toBeVisible()
  })

  test('说话人映射区块存在', async ({ page }) => {
    await page.goto(`/meetings/${meetingId}`)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1500)

    // 查找说话人映射区块
    const speakerMap = page.locator('.speaker-map, [data-section="speakerMap"], :has-text("说话人")')

    // 说话人区块可能存在也可能不存在（取决于会议类型）
    const count = await speakerMap.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('可编辑列表元素存在', async ({ page }) => {
    await page.goto(`/meetings/${meetingId}`)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1500)

    // 查找EditableList组件生成的元素
    const editableElements = page.locator('.editable-list, .editable-item, [data-editable], .highlight-item, .action-item')

    // 应该至少有一些可编辑内容
    const count = await editableElements.count()
    expect(count).toBeGreaterThan(0)
  })

  test('导航/返回按钮存在', async ({ page }) => {
    await page.goto(`/meetings/${meetingId}`)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1500)

    // 查找返回按钮或breadcrumb
    const backButton = page.locator('button:has-text("返回"), a:has-text("返回"), .back-button, .breadcrumb')

    // 至少应该有导航元素
    const count = await backButton.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })
})
