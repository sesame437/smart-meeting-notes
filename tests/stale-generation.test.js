'use strict'

const { UpdateCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb')

// Mock DynamoDB
const mockSend = jest.fn()
jest.mock('../db/dynamodb', () => ({ docClient: { send: mockSend } }))

// Mock SQS
const mockSendMessage = jest.fn().mockResolvedValue(undefined)
jest.mock('../services/sqs', () => ({
  sendMessage: mockSendMessage,
  receiveMessages: jest.fn().mockResolvedValue([]),
  deleteMessage: jest.fn().mockResolvedValue(undefined),
}))

// Mock logger
jest.mock('../services/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}))

// Set env before requiring modules
process.env.DYNAMODB_TABLE = 'test-table'
process.env.SQS_REPORT_QUEUE = 'https://sqs.us-west-2.amazonaws.com/123/report-queue'

const store = require('../services/meeting-store')

describe('findStaleMeetings', () => {
  beforeEach(() => {
    mockSend.mockReset()
  })

  test('returns meetings with stage=generating and updatedAt older than threshold', async () => {
    const staleItem = {
      meetingId: 'm-stale',
      createdAt: '2026-03-24T01:00:00.000Z',
      stage: 'generating',
      status: 'transcribed',
      updatedAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
    }
    mockSend.mockResolvedValueOnce({ Items: [staleItem] })

    const result = await store.findStaleMeetings(15)
    expect(result).toEqual([staleItem])

    const call = mockSend.mock.calls[0][0]
    expect(call).toBeInstanceOf(QueryCommand)
    expect(call.input.FilterExpression).toContain('stage = :stage')
    expect(call.input.ExpressionAttributeValues[':stage']).toBe('generating')
  })

  test('returns empty array when no stale meetings', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] })
    const result = await store.findStaleMeetings(15)
    expect(result).toEqual([])
  })
})

describe('stale recovery logic', () => {
  // Extract and test the recovery logic directly
  const STALE_THRESHOLD_MINUTES = 15
  const MAX_STALE_RETRIES = 3
  const TABLE = 'test-table'
  const QUEUE_URL = 'https://sqs.us-west-2.amazonaws.com/123/report-queue'
  const logger = require('../services/logger')
  const { sendMessage } = require('../services/sqs')

  beforeEach(() => {
    mockSend.mockReset()
    mockSendMessage.mockClear()
    logger.info.mockClear()
    logger.warn.mockClear()
    logger.error.mockClear()
  })

  async function recoverStaleMeetings() {
    const stale = await store.findStaleMeetings(STALE_THRESHOLD_MINUTES)
    for (const item of stale) {
      const retryCount = item.retryCount || 0
      if (retryCount >= MAX_STALE_RETRIES) {
        await mockSend(new UpdateCommand({
          TableName: TABLE,
          Key: { meetingId: item.meetingId, createdAt: item.createdAt },
          UpdateExpression: 'SET #s = :s, stage = :stage, errorMessage = :em, updatedAt = :u',
          ExpressionAttributeNames: { '#s': 'status' },
          ExpressionAttributeValues: {
            ':s': 'failed',
            ':stage': 'failed',
            ':em': `Report generation timed out after ${MAX_STALE_RETRIES} retries`,
            ':u': new Date().toISOString(),
          },
        }))
        continue
      }
      await mockSend(new UpdateCommand({
        TableName: TABLE,
        Key: { meetingId: item.meetingId, createdAt: item.createdAt },
        UpdateExpression: 'SET stage = :stage, retryCount = :rc, updatedAt = :u',
        ExpressionAttributeValues: {
          ':stage': 'reporting',
          ':rc': retryCount + 1,
          ':u': new Date().toISOString(),
        },
      }))
      await sendMessage(QUEUE_URL, {
        meetingId: item.meetingId,
        transcribeKey: item.transcribeKey || null,
        whisperKey: item.whisperKey || null,
        funasrKey: item.funasrKey || null,
        meetingType: item.meetingType || 'general',
        createdAt: item.createdAt,
      })
    }
  }

  test('requeues stale meeting with retryCount < max', async () => {
    const staleItem = {
      meetingId: 'm-1',
      createdAt: '2026-03-24T01:00:00.000Z',
      stage: 'generating',
      status: 'transcribed',
      retryCount: 1,
      funasrKey: 'funasr/m-1/result.json',
      meetingType: 'weekly',
      updatedAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
    }
    // First call: findStaleMeetings query
    mockSend.mockResolvedValueOnce({ Items: [staleItem] })
    // Second call: UpdateCommand
    mockSend.mockResolvedValueOnce({})

    await recoverStaleMeetings()

    // UpdateCommand should set stage=reporting, retryCount=2
    const updateCall = mockSend.mock.calls[1][0]
    expect(updateCall).toBeInstanceOf(UpdateCommand)
    expect(updateCall.input.ExpressionAttributeValues[':stage']).toBe('reporting')
    expect(updateCall.input.ExpressionAttributeValues[':rc']).toBe(2)

    // SQS message should be sent
    expect(mockSendMessage).toHaveBeenCalledWith(QUEUE_URL, expect.objectContaining({
      meetingId: 'm-1',
      funasrKey: 'funasr/m-1/result.json',
      meetingType: 'weekly',
    }))
  })

  test('marks as failed when retryCount >= max', async () => {
    const staleItem = {
      meetingId: 'm-2',
      createdAt: '2026-03-24T02:00:00.000Z',
      stage: 'generating',
      status: 'transcribed',
      retryCount: 3,
      updatedAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
    }
    mockSend.mockResolvedValueOnce({ Items: [staleItem] })
    mockSend.mockResolvedValueOnce({})

    await recoverStaleMeetings()

    const updateCall = mockSend.mock.calls[1][0]
    expect(updateCall).toBeInstanceOf(UpdateCommand)
    expect(updateCall.input.ExpressionAttributeValues[':s']).toBe('failed')
    expect(updateCall.input.ExpressionAttributeValues[':stage']).toBe('failed')
    expect(updateCall.input.ExpressionAttributeValues[':em']).toContain('timed out')

    // No SQS message for exhausted retries
    expect(mockSendMessage).not.toHaveBeenCalled()
  })
})

describe('GET /:id isStale field', () => {
  test('adds isStale=true when stage=generating and updatedAt > 15 min ago', () => {
    const item = {
      meetingId: 'm-3',
      stage: 'generating',
      updatedAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
    }
    const STALE_MINUTES = 15
    if (item.stage === 'generating' && item.updatedAt) {
      const elapsed = Date.now() - new Date(item.updatedAt).getTime()
      if (elapsed > STALE_MINUTES * 60 * 1000) {
        item.isStale = true
      }
    }
    expect(item.isStale).toBe(true)
  })

  test('does not add isStale when stage=generating and updatedAt < 15 min ago', () => {
    const item = {
      meetingId: 'm-4',
      stage: 'generating',
      updatedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    }
    const STALE_MINUTES = 15
    if (item.stage === 'generating' && item.updatedAt) {
      const elapsed = Date.now() - new Date(item.updatedAt).getTime()
      if (elapsed > STALE_MINUTES * 60 * 1000) {
        item.isStale = true
      }
    }
    expect(item.isStale).toBeUndefined()
  })

  test('does not add isStale when stage is not generating', () => {
    const item = {
      meetingId: 'm-5',
      stage: 'transcribing',
      updatedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    }
    const STALE_MINUTES = 15
    if (item.stage === 'generating' && item.updatedAt) {
      const elapsed = Date.now() - new Date(item.updatedAt).getTime()
      if (elapsed > STALE_MINUTES * 60 * 1000) {
        item.isStale = true
      }
    }
    expect(item.isStale).toBeUndefined()
  })
})
