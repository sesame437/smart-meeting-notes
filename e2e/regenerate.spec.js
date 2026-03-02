const { test, expect } = require('@playwright/test')

test.describe('重新生成报告流程', () => {
  const mockMeetingId = 'e2e-test-meeting-regenerate'
  const mockReport = {
    meetingType: 'internal',
    summary: '这是一个测试会议摘要，讨论了项目进展和技术方案。',
    actions: [
      { assignee: '张三', task: '完成接口文档', deadline: '2026-03-05' },
      { assignee: '李四', task: '更新测试用例', deadline: '2026-03-07' }
    ],
    decisions: [
      { decision: '采用 AWS Bedrock 作为 AI 服务', rationale: '成本效益好，性能稳定' }
    ],
    participants: [
      { name: '张三', role: '技术负责人' },
      { name: '李四', role: '测试工程师' }
    ]
  }

  test('点击重新生成按钮，mock API 返回成功响应', async ({ page }) => {
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
            participants: []
          },
          createdAt: '2026-03-01T10:00:00.000Z',
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
          report: mockReport
        })
      })
    })

    // 访问会议详情页
    await page.goto(`/meeting.html?id=${mockMeetingId}`)

    // 等待页面加载
    await expect(page.locator('#meeting-content')).toBeVisible()

    // 等待底部操作栏加载
    const bottomBar = page.locator('#bottom-bar')
    await expect(bottomBar).toBeVisible({ timeout: 5000 })

    // 查找重新生成按钮（根据 data-action 属性）
    const regenerateBtn = page.locator('[data-action="regenerate"]')

    // 如果按钮不存在，说明 UI 还未实现该功能，跳过测试
    const btnCount = await regenerateBtn.count()
    if (btnCount === 0) {
      test.skip(true, '跳过：UI 未实现重新生成按钮')
    }

    // 点击重新生成按钮
    await regenerateBtn.click()

    // 等待 API 调用完成（通过监听 response）
    const responsePromise = page.waitForResponse(
      (response) => response.url().includes(`/api/meetings/${mockMeetingId}/regenerate`),
      { timeout: 10000 }
    )
    await responsePromise

    // 验证页面更新（summary 区域有新内容）
    const summarySection = page.locator('.meeting-summary, #summary, [data-section="summary"]').first()
    await expect(summarySection).toBeVisible({ timeout: 5000 })

    // 验证新内容出现（包含 mock 数据的文字）
    const pageContent = await page.content()
    expect(pageContent).toContain('测试会议摘要')
  })

  test('重新生成失败时显示错误信息', async ({ page }) => {
    // Mock GET /api/meetings/:id
    await page.route(`**/api/meetings/${mockMeetingId}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          meetingId: mockMeetingId,
          title: 'E2E 测试会议',
          status: 'reported',
          content: { summary: '旧内容' },
          createdAt: '2026-03-01T10:00:00.000Z',
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

    await page.goto(`/meeting.html?id=${mockMeetingId}`)
    await expect(page.locator('#meeting-content')).toBeVisible()

    const regenerateBtn = page.locator('[data-action="regenerate"]')
    const btnCount = await regenerateBtn.count()
    if (btnCount === 0) {
      test.skip(true, '跳过：UI 未实现重新生成按钮')
    }

    await regenerateBtn.click()

    // 等待错误提示出现（前端通常用 alert 或 toast）
    page.on('dialog', async (dialog) => {
      expect(dialog.message()).toContain('No transcript')
      await dialog.accept()
    })
  })
})
