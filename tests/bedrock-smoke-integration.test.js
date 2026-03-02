// @integration - 需要 AWS 凭证，平时 npm test 不跑
// 运行方式：npm run test:integration

require('dotenv').config()
const { invokeModel } = require('../services/bedrock')

const runIntegrationTests = process.env.RUN_INTEGRATION_TESTS === 'true'
const describeOrSkip = runIntegrationTests ? describe : describe.skip

describeOrSkip('Bedrock Integration Smoke Test', () => {
  // 延长超时时间，真实 API 调用需要更多时间
  jest.setTimeout(30000)

  test('invokeModel 能正常调用 Bedrock（短文本）', async () => {
    // 验证环境变量存在
    expect(process.env.BEDROCK_REGION).toBeDefined()
    expect(process.env.BEDROCK_MODEL_ID).toBeDefined()

    // 调用 Bedrock，使用短文本 + 小 token 限制
    const transcript = '这是一个测试会议。主要讨论了项目进展。'
    const meetingType = 'general'
    const glossaryTerms = []
    const modelId = process.env.BEDROCK_MODEL_ID

    // 不传 speakerMap，使用默认 null
    const responseText = await invokeModel(transcript, meetingType, glossaryTerms, modelId, null)

    // 验证返回非空字符串
    expect(typeof responseText).toBe('string')
    expect(responseText.length).toBeGreaterThan(0)

    // 验证返回内容至少包含 JSON 标记（Bedrock 通常返回 JSON）
    expect(responseText).toMatch(/\{.*\}/)
  })

  test('BEDROCK_REGION 和 BEDROCK_MODEL_ID 从 .env 正确读取', () => {
    // 验证环境变量格式正确
    const region = process.env.BEDROCK_REGION
    const modelId = process.env.BEDROCK_MODEL_ID

    expect(region).toBeTruthy()
    expect(modelId).toBeTruthy()

    // 验证 region 格式（如 us-west-2 或 us-east-1）
    expect(region).toMatch(/^[a-z]{2}-[a-z]+-\d+$/)

    // 验证 modelId 格式（如 us.anthropic.claude-sonnet-4-6）
    expect(modelId).toContain('anthropic')
  })
})
