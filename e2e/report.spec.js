const { test, expect } = require('@playwright/test')

test.describe('会议详情页', () => {
  let meetingId = null

  test.beforeAll(async ({ request }) => {
    // 查询现有会议，如果有则使用第一个
    const response = await request.get('/api/meetings?limit=1')
    const data = await response.json()

    if (data.items && data.items.length > 0) {
      meetingId = data.items[0].meetingId
    }
  })

  test('会议详情页加载（如果有会议数据）', async ({ page }) => {
    test.skip(!meetingId, '跳过：无可用会议数据')

    await page.goto(`/meeting.html?id=${meetingId}`)
    await expect(page).toHaveTitle(/会议详情/)

    // 等待内容容器加载
    const content = page.locator('#meeting-content')
    await expect(content).toBeVisible()
  })

  test('会议详情页有底部操作栏', async ({ page }) => {
    test.skip(!meetingId, '跳过：无可用会议数据')

    await page.goto(`/meeting.html?id=${meetingId}`)

    // 等待底部操作栏加载（app.js 动态注入）
    const bottomBar = page.locator('#bottom-bar')
    await expect(bottomBar).toBeVisible({ timeout: 5000 })
  })

  test('无会议数据时显示占位状态', async ({ page }) => {
    test.skip(meetingId !== null, '跳过：有可用会议数据')

    await page.goto('/')
    const meetingsList = page.locator('#meetings-list')
    await expect(meetingsList).toBeVisible()
  })
})
