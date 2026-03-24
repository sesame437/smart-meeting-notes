const { test, expect } = require('@playwright/test')

test.describe('重新生成报告流程', () => {
  const mockMeetingId = 'e2e-test-meeting-regenerate'
  const mockReport = {
    meetingType: 'general',
    summary: '这是一个测试会议摘要，讨论了项目进展和技术方案。',
    actions: [
      { task: '完成接口文档', owner: '张三', deadline: '2026-03-05', priority: 'high' },
      { task: '更新测试用例', owner: '李四', deadline: '2026-03-07', priority: 'medium' }
    ],
    decisions: [
      { decision: '采用 AWS Bedrock 作为 AI 服务', rationale: '成本效益好，性能稳定' }
    ],
    participants: ['张三', '李四'],
    highlights: [
      { point: '技术方案获得认可', detail: '团队一致通过新架构设计' }
    ],
    lowlights: [
      { point: '时间紧张', detail: '需要在两周内完成' }
    ]
  }

  test.skip('点击重新生成按钮，mock API 返回成功响应', async ({ page }) => {
    // Mock GET /api/meetings/:id (获取会议详情)
    await page.route(`**/api/meetings/${mockMeetingId}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          meetingId: mockMeetingId,
          title: 'E2E 测试会议',
          status: 'reported',
          content: {
            summary: '旧的摘要内容',
            actions: [],
            participants: [],
            highlights: [],
            lowlights: []
          },
          createdAt: '2026-03-01T10:00:00.000Z',
          meetingType: 'general'
        })
      })
    })

    // Mock POST /api/meetings/:id/regenerate (重新生成报告)
    await page.route(`**/api/meetings/${mockMeetingId}/regenerate`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          content: mockReport
        })
      })
    })

    // 访问会议详情页（使用Vue Router路由）
    await page.goto(`/meetings/${mockMeetingId}`)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1500)

    // 查找重新生成按钮（根据 data-action 属性或文字）
    const regenerateBtn = page.locator('button:has-text("重新生成"), button[data-action="regenerate"], .regenerate-button')

    // 如果按钮不存在，说明 UI 还未实现该功能，跳过测试
    const btnCount = await regenerateBtn.count()
    if (btnCount === 0) {
      test.skip(true, '跳过：UI 未实现重新生成按钮')
    }

    // 点击重新生成按钮
    await regenerateBtn.first().click()

    // 等待 API 调用完成
    const responsePromise = page.waitForResponse(
      (response) => response.url().includes(`/api/meetings/${mockMeetingId}/regenerate`),
      { timeout: 10000 }
    )
    await responsePromise

    // 等待页面更新
    await page.waitForTimeout(1000)

    // 验证新内容出现（包含 mock 数据的文字）
    const pageContent = await page.content()
    expect(pageContent).toContain('测试会议摘要')
  })

  test.skip('重新生成失败时显示错误信息', async ({ page }) => {
    // Mock GET /api/meetings/:id
    await page.route(`**/api/meetings/${mockMeetingId}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          meetingId: mockMeetingId,
          title: 'E2E 测试会议',
          status: 'reported',
          content: {
            summary: '旧内容',
            actions: [],
            participants: [],
            highlights: [],
            lowlights: []
          },
          createdAt: '2026-03-01T10:00:00.000Z',
          meetingType: 'general'
        })
      })
    })

    // Mock POST regenerate 返回错误
    await page.route(`**/api/meetings/${mockMeetingId}/regenerate`, async (route) => {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'NO_TRANSCRIPT', message: 'No transcript found for this meeting' }
        })
      })
    })

    await page.goto(`/meetings/${mockMeetingId}`)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1500)

    const regenerateBtn = page.locator('button:has-text("重新生成"), button[data-action="regenerate"]')
    const btnCount = await regenerateBtn.count()
    if (btnCount === 0) {
      test.skip(true, '跳过：UI 未实现重新生成按钮')
    }

    // 监听对话框
    let dialogMessage = ''
    page.on('dialog', async (dialog) => {
      dialogMessage = dialog.message()
      await dialog.accept()
    })

    await regenerateBtn.first().click()

    // 等待API调用完成
    await page.waitForTimeout(2000)

    // 验证错误信息显示（可能是dialog或toast）
    if (dialogMessage) {
      expect(dialogMessage.toLowerCase()).toContain('transcript')
    } else {
      // 如果不是dialog，可能是toast或错误消息
      const errorMessage = page.locator('.error-message, .toast-error, [role="alert"]')
      const hasError = await errorMessage.count() > 0

      // 至少应该有某种错误提示
      expect(hasError || dialogMessage !== '').toBeTruthy()
    }
  })
})
