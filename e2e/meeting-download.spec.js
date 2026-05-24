const { test, expect } = require('@playwright/test')

test.describe('Meeting transcript download', () => {
  test('详情页存在下载转录按钮', async ({ page }) => {
    const apiResp = await page.request.get('/api/meetings')
    const list = await apiResp.json()
    const target = list.find((m) => m.funasrKey)
    test.skip(!target, 'no meeting with funasrKey for download test')

    await page.goto(`/meeting.html?id=${target.meetingId}`)
    await page.waitForLoadState('networkidle')

    const btn = page.locator('[data-action="download-transcript"]')
    await expect(btn).toBeVisible()
    await expect(btn).toBeEnabled()

    await page.screenshot({ path: 'e2e/screenshots/meeting-download-button-enabled.png' })
  })

  test('点击按钮触发 transcript-url 接口并返回 url', async ({ page }) => {
    const apiResp = await page.request.get('/api/meetings')
    const list = await apiResp.json()
    const target = list.find((m) => m.funasrKey)
    test.skip(!target, 'no meeting with funasrKey for download test')

    // Assert response shape directly (CDP body access in-page is unreliable when click triggers a download)
    const directResp = await page.request.get(`/api/meetings/${target.meetingId}/transcript-url`)
    expect(directResp.status()).toBe(200)
    const body = await directResp.json()
    expect(body).toHaveProperty('url')
    expect(body).toHaveProperty('expiresIn', 900)
    expect(typeof body.url).toBe('string')
    expect(body.url).toMatch(/^https?:\/\//)

    // Then verify the UI button actually triggers the endpoint
    await page.goto(`/meeting.html?id=${target.meetingId}`)
    await page.waitForLoadState('networkidle')

    page.on('download', (download) => download.cancel())

    const [clickResp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/transcript-url') && r.status() === 200),
      page.click('[data-action="download-transcript"]'),
    ])
    expect(clickResp.status()).toBe(200)

    await page.screenshot({ path: 'e2e/screenshots/meeting-download-clicked.png' })
  })

  test('无 funasrKey 的会议按钮 disabled', async ({ page }) => {
    const apiResp = await page.request.get('/api/meetings')
    const list = await apiResp.json()
    const target = list.find((m) => !m.funasrKey)
    test.skip(!target, 'no meeting without funasrKey')

    await page.goto(`/meeting.html?id=${target.meetingId}`)
    await page.waitForLoadState('networkidle')

    const btn = page.locator('[data-action="download-transcript"]')
    if (await btn.count() > 0) {
      await expect(btn).toBeDisabled()
    }

    await page.screenshot({ path: 'e2e/screenshots/meeting-download-button-disabled.png' })
  })
})
