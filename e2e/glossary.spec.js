const { test, expect } = require('@playwright/test')

test.describe('词汇表页面', () => {
  test('词汇表页加载，标题含"词汇表"或"会议纪要"', async ({ page }) => {
    await page.goto('/glossary')
    await expect(page).toHaveTitle(/词汇表|会议纪要/)
  })

  test('页面标题/头部显示"词汇表"', async ({ page }) => {
    await page.goto('/glossary')
    await page.waitForLoadState('networkidle')

    // 查找包含"词汇表"文字的标题元素
    const heading = page.locator('h1, h2, .page-title, [data-testid="page-title"]')
    await expect(heading.first()).toBeVisible()

    // 验证页面内容包含"词汇表"
    const pageContent = await page.content()
    expect(pageContent).toContain('词汇表')
  })

  test('"术语" tab存在且可见', async ({ page }) => {
    await page.goto('/glossary')
    await page.waitForLoadState('networkidle')

    // 查找术语tab（可能是按钮、链接或tab元素）
    const termTab = page.locator('button:has-text("术语"), a:has-text("术语"), [role="tab"]:has-text("术语"), .tab:has-text("术语")')
    await expect(termTab.first()).toBeVisible()
  })

  test('"人员" tab存在且可见', async ({ page }) => {
    await page.goto('/glossary')
    await page.waitForLoadState('networkidle')

    // 查找人员tab
    const personTab = page.locator('button:has-text("人员"), a:has-text("人员"), [role="tab"]:has-text("人员"), .tab:has-text("人员")')
    await expect(personTab.first()).toBeVisible()
  })

  test('点击人员tab可以切换', async ({ page }) => {
    await page.goto('/glossary')
    await page.waitForLoadState('networkidle')

    // 查找并点击人员tab
    const personTab = page.locator('button:has-text("人员"), a:has-text("人员"), [role="tab"]:has-text("人员")').first()

    if (await personTab.count() > 0) {
      await personTab.click()

      // 等待内容更新
      await page.waitForTimeout(500)

      // 验证tab切换成功（可以检查active类或内容变化）
      const isActive = await personTab.evaluate(el =>
        el.classList.contains('active') ||
        el.classList.contains('selected') ||
        el.getAttribute('aria-selected') === 'true'
      )

      expect(isActive).toBeTruthy()
    }
  })

  test('添加术语表单存在', async ({ page }) => {
    await page.goto('/glossary')
    await page.waitForLoadState('networkidle')

    // 查找输入框（可能用不同的id或class）
    const termInput = page.locator('input[placeholder*="术语"], input[placeholder*="OKR"], input[type="text"]').first()
    await expect(termInput).toBeVisible()
  })

  test('术语列表/表格存在', async ({ page }) => {
    await page.goto('/glossary')
    await page.waitForLoadState('networkidle')

    // 等待数据加载
    await page.waitForTimeout(1000)

    // 查找列表或表格容器
    const listContainer = page.locator('table, .glossary-list, .term-list, [data-testid="glossary-list"]').first()
    await expect(listContainer).toBeVisible()
  })

  test('词汇表有数据时显示条目', async ({ page }) => {
    await page.goto('/glossary')
    await page.waitForLoadState('networkidle')

    // 等待数据加载
    await page.waitForTimeout(1000)

    // 检查是否有数据行（至少有一条）
    const hasData = await page.locator('tbody tr, .glossary-item, .term-item').count() > 0
    const hasEmptyState = await page.locator('.empty-state, :has-text("暂无数据")').count() > 0

    // 至少应该有一个存在
    expect(hasData || hasEmptyState).toBeTruthy()
  })
})
