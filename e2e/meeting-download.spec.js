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
    const listResp = await page.request.get('/api/meetings')
    const list = await listResp.json()
    const target = list.find((m) => m.funasrKey)
    test.skip(!target, 'no meeting with funasrKey for download test')

    await page.goto(`/meeting.html?id=${target.meetingId}`)
    await page.waitForLoadState('networkidle')

    // Stub the actual S3 download so the browser doesn't pull a real file
    await page.route(/\.s3[.\-]/, (route) => route.fulfill({ status: 200, body: 'stub' }))

    // Call the transcript-url API directly to verify response shape
    const apiResp = await page.request.get(`/api/meetings/${target.meetingId}/transcript-url`)
    expect(apiResp.status()).toBe(200)

    const body = await apiResp.json()
    expect(body).toHaveProperty('url')
    expect(body).toHaveProperty('expiresIn', 900)
    expect(typeof body.url).toBe('string')
    expect(body.url).toMatch(/^https?:\/\//)

    // Now test the button interaction
    const clickResponsePromise = page.waitForResponse(
      (r) => r.url().includes('/transcript-url') && r.status() === 200
    )
    await page.click('[data-action="download-transcript"]')
    await clickResponsePromise

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
