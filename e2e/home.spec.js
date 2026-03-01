const { test, expect } = require('@playwright/test')

test.describe('首页（会议列表）', () => {
  test('首页加载，标题含"会议纪要"', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveTitle(/会议纪要/)
  })

  test('导航栏存在（含"词汇表"链接）', async ({ page }) => {
    await page.goto('/')
    const nav = page.locator('.navbar')
    await expect(nav).toBeVisible()

    const glossaryLink = page.locator('a[href="glossary.html"]')
    await expect(glossaryLink).toBeVisible()
    await expect(glossaryLink).toHaveText(/词汇表/)
  })

  test('会议列表容器存在（即使为空）', async ({ page }) => {
    await page.goto('/')
    const meetingsList = page.locator('#meetings-list')
    await expect(meetingsList).toBeVisible()
  })
})
