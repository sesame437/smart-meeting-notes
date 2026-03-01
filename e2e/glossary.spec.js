const { test, expect } = require('@playwright/test')

test.describe('词库页（词汇表管理）', () => {
  test('词库页加载，标题含"词汇表"', async ({ page }) => {
    await page.goto('/glossary.html')
    await expect(page).toHaveTitle(/词汇表/)
  })

  test('导航栏词汇表链接处于激活状态', async ({ page }) => {
    await page.goto('/glossary.html')
    const glossaryLink = page.locator('a[href="glossary.html"]')
    await expect(glossaryLink).toHaveClass(/active/)
  })

  test('添加术语表单存在', async ({ page }) => {
    await page.goto('/glossary.html')
    const form = page.locator('#add-term-form')
    await expect(form).toBeVisible()

    const termInput = page.locator('#add-term')
    await expect(termInput).toBeVisible()
    await expect(termInput).toHaveAttribute('placeholder', /OKR/)
  })

  test('术语列表表格存在', async ({ page }) => {
    await page.goto('/glossary.html')
    const tbody = page.locator('#glossary-tbody')
    await expect(tbody).toBeVisible()
  })
})
