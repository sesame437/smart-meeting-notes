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

  test('点击按钮触发 HTTP 请求', async ({ page }) => {
    const apiResp = await page.request.get('/api/meetings')
    const list = await apiResp.json()
    const target = list.find((m) => m.funasrKey)
    test.skip(!target, 'no meeting with funasrKey for download test')

    await page.goto(`/meeting.html?id=${target.meetingId}`)
    await page.waitForLoadState('networkidle')

    // Monitor network requests
    let transcriptUrlRequested = false
    page.on('request', (request) => {
      if (request.url().includes('/transcript-url')) {
        transcriptUrlRequested = true
      }
    })

    // Route to intercept and respond immediately (to avoid timeout)
    await page.route('**/transcript-url', (route) => {
      route.abort('blockedbyclient')
    })

    // Click the download button
    const btn = page.locator('[data-action="download-transcript"]')
    await btn.click()

    // Wait a bit for the request to be triggered
    await page.waitForTimeout(500)

    // Verify the request was made
    expect(transcriptUrlRequested).toBe(true)

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
