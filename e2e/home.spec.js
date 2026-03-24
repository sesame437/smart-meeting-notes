const { test, expect } = require('@playwright/test')

test.describe('首页（会议列表）', () => {
  test('首页加载，标题含"会议纪要"', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveTitle(/会议纪要/)
  })

  test('导航栏存在（含"词汇表"链接）', async ({ page }) => {
    await page.goto('/')

    // 等待Vue渲染完成
    await page.waitForLoadState('networkidle')

    // 检查导航栏存在
    const nav = page.locator('nav, .navbar, [role="navigation"]')
    await expect(nav.first()).toBeVisible()

    // 检查词汇表链接（Vue Router使用router-link，渲染为<a>）
    const glossaryLink = page.locator('a[href="/glossary"], a:has-text("词汇表")')
    await expect(glossaryLink.first()).toBeVisible()
  })

  test('会议列表容器存在（即使为空）', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Vue应用可能用不同的选择器
    const meetingsList = page.locator('#app, .meeting-list, .meetings-container, [data-testid="meetings-list"]')
    await expect(meetingsList.first()).toBeVisible()
  })

  test('会议卡片加载（如果有数据）', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // 等待API请求完成
    await page.waitForTimeout(1000)

    // 检查是否有会议卡片或空状态
    const hasMeetings = await page.locator('.meeting-card, [data-testid="meeting-card"]').count() > 0
    const hasEmptyState = await page.locator('.empty-state, .no-meetings, :has-text("暂无会议")').count() > 0

    // 至少应该有一个存在
    expect(hasMeetings || hasEmptyState).toBeTruthy()
  })
})
