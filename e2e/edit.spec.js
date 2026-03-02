const { test, expect } = require('@playwright/test')

test.describe('会议详情页编辑功能', () => {
  let meetingId = null

  test.beforeAll(async ({ request }) => {
    // 查询现有会议，如果有则使用第一个
    const response = await request.get('/api/meetings?limit=1')
    const data = await response.json()

    if (data.items && data.items.length > 0) {
      meetingId = data.items[0].meetingId
    }
  })

  test('.editable-row 元素存在', async ({ page }) => {
    test.skip(!meetingId, '跳过：无可用会议数据')

    await page.goto(`/meeting.html?id=${meetingId}`)

    // 等待页面加载
    const content = page.locator('#meeting-content')
    await expect(content).toBeVisible()

    // 检查 .editable-row 元素存在
    const editableRows = page.locator('.editable-row')
    const count = await editableRows.count()
    expect(count).toBeGreaterThan(0)
  })

  test('编辑按钮在 hover 时显示', async ({ page }) => {
    test.skip(!meetingId, '跳过：无可用会议数据')

    await page.goto(`/meeting.html?id=${meetingId}`)

    // 等待页面加载
    const content = page.locator('#meeting-content')
    await expect(content).toBeVisible()

    // 查找第一个 .editable-row
    const firstEditableRow = page.locator('.editable-row').first()
    await expect(firstEditableRow).toBeVisible()

    // Hover 到这个元素上
    await firstEditableRow.hover()

    // 检查编辑按钮容器存在（操作按钮应该在 .row-actions 中）
    const rowActions = firstEditableRow.locator('.row-actions')
    await expect(rowActions).toBeVisible()
  })

  test('删除确认弹窗结构存在', async ({ page }) => {
    test.skip(!meetingId, '跳过：无可用会议数据')

    await page.goto(`/meeting.html?id=${meetingId}`)

    // 等待页面加载
    const content = page.locator('#meeting-content')
    await expect(content).toBeVisible()

    // 检查 .confirm-dialog 元素存在（初始状态可能隐藏）
    const confirmDialog = page.locator('.confirm-dialog')
    // 只检查元素存在，不要求 visible（因为初始状态是隐藏的）
    await expect(confirmDialog).toHaveCount(1)
  })
})
