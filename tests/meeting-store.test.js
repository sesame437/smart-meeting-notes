const { docClient } = require("../db/dynamodb")
const {
  ScanCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  QueryCommand,
} = require("@aws-sdk/lib-dynamodb")
const {
  listMeetings,
  createMeeting,
  updateMeeting,
  deleteMeeting,
  createMeetingFromUpload,
  retryMeeting,
  rollbackRetry,
  getGlossaryItems,
  saveReport,
  updateMeetingReport,
  markEmailSent,
  queryMeetingById,
} = require("../services/meeting-store")

jest.mock("../db/dynamodb", () => ({
  docClient: { send: jest.fn() },
}))

describe("meeting-store", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe("listMeetings", () => {
    it("should return array of meetings when Items exist", async () => {
      const mockItems = [{ meetingId: "1", createdAt: "2026-01-01T00:00:00.000Z" }]
      docClient.send.mockResolvedValueOnce({ Items: mockItems })

      const result = await listMeetings()

      expect(result).toEqual(mockItems)
      expect(docClient.send).toHaveBeenCalledWith(expect.any(ScanCommand))
    })

    it("should return empty array when Items is null", async () => {
      docClient.send.mockResolvedValueOnce({ Items: null })

      const result = await listMeetings()

      expect(result).toEqual([])
    })

    it("should propagate error when send throws", async () => {
      const error = new Error("DynamoDB error")
      docClient.send.mockRejectedValueOnce(error)

      await expect(listMeetings()).rejects.toThrow("DynamoDB error")
    })
  })

  describe("createMeeting", () => {
    it("should call PutCommand and return item", async () => {
      const mockItem = { meetingId: "1", createdAt: "2026-01-01T00:00:00.000Z", status: "pending" }
      docClient.send.mockResolvedValueOnce({})

      const result = await createMeeting(mockItem)

      expect(result).toEqual(mockItem)
      expect(docClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            TableName: process.env.DYNAMODB_TABLE,
            Item: mockItem,
          }),
        })
      )
    })

    it("should not throw error when item is empty object", async () => {
      docClient.send.mockResolvedValueOnce({})

      const result = await createMeeting({})

      expect(result).toEqual({})
    })

    it("should propagate error when send throws", async () => {
      const error = new Error("Put failed")
      docClient.send.mockRejectedValueOnce(error)

      await expect(createMeeting({ meetingId: "1" })).rejects.toThrow("Put failed")
    })
  })

  describe("updateMeeting", () => {
    it("should return Attributes from UpdateCommand", async () => {
      const mockAttributes = { meetingId: "1", createdAt: "2026-01-01T00:00:00.000Z", status: "done" }
      docClient.send.mockResolvedValueOnce({ Attributes: mockAttributes })

      const result = await updateMeeting(
        "1",
        "2026-01-01T00:00:00.000Z",
        ["#s = :s"],
        { "#s": "status" },
        { ":s": "done" }
      )

      expect(result).toEqual(mockAttributes)
      expect(docClient.send).toHaveBeenCalledWith(expect.any(UpdateCommand))
    })

    it("should set ExpressionAttributeNames to undefined when names is empty", async () => {
      docClient.send.mockResolvedValueOnce({ Attributes: {} })

      await updateMeeting("1", "2026-01-01T00:00:00.000Z", ["status = :s"], {}, { ":s": "done" })

      const call = docClient.send.mock.calls[0][0]
      expect(call.input.ExpressionAttributeNames).toBeUndefined()
    })

    it("should propagate error when send throws", async () => {
      const error = new Error("Update failed")
      docClient.send.mockRejectedValueOnce(error)

      await expect(
        updateMeeting("1", "2026-01-01T00:00:00.000Z", ["#s = :s"], { "#s": "status" }, { ":s": "done" })
      ).rejects.toThrow("Update failed")
    })
  })

  describe("deleteMeeting", () => {
    it("should call DeleteCommand with correct key", async () => {
      docClient.send.mockResolvedValueOnce({})

      await deleteMeeting("1", "2026-01-01T00:00:00.000Z")

      expect(docClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            TableName: process.env.DYNAMODB_TABLE,
            Key: { meetingId: "1", createdAt: "2026-01-01T00:00:00.000Z" },
          }),
        })
      )
    })

    it("should not throw error when item does not exist", async () => {
      docClient.send.mockResolvedValueOnce({})

      await expect(deleteMeeting("nonexistent", "2026-01-01T00:00:00.000Z")).resolves.toBeUndefined()
    })

    it("should propagate error when send throws", async () => {
      const error = new Error("Delete failed")
      docClient.send.mockRejectedValueOnce(error)

      await expect(deleteMeeting("1", "2026-01-01T00:00:00.000Z")).rejects.toThrow("Delete failed")
    })
  })

  describe("createMeetingFromUpload", () => {
    it("should call PutCommand and return item", async () => {
      const mockItem = { meetingId: "1", createdAt: "2026-01-01T00:00:00.000Z", s3Key: "inbox/1/file.mp3" }
      docClient.send.mockResolvedValueOnce({})

      const result = await createMeetingFromUpload(mockItem)

      expect(result).toEqual(mockItem)
      expect(docClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            TableName: process.env.DYNAMODB_TABLE,
            Item: mockItem,
          }),
        })
      )
    })

    it("should handle item with minimal fields", async () => {
      docClient.send.mockResolvedValueOnce({})

      const result = await createMeetingFromUpload({ meetingId: "1" })

      expect(result).toEqual({ meetingId: "1" })
    })

    it("should propagate error when send throws", async () => {
      const error = new Error("Put failed")
      docClient.send.mockRejectedValueOnce(error)

      await expect(createMeetingFromUpload({ meetingId: "1" })).rejects.toThrow("Put failed")
    })
  })

  describe("retryMeeting", () => {
    it("should call UpdateCommand with correct condition", async () => {
      docClient.send.mockResolvedValueOnce({})

      await retryMeeting("1", "2026-01-01T00:00:00.000Z", "SET #s = :s, stage = :stage, updatedAt = :u")

      expect(docClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            ConditionExpression: "#s = :failed",
            ExpressionAttributeNames: { "#s": "status" },
          }),
        })
      )
    })

    it("should propagate ConditionalCheckFailedException when condition not met", async () => {
      const error = new Error("ConditionalCheckFailedException")
      error.name = "ConditionalCheckFailedException"
      docClient.send.mockRejectedValueOnce(error)

      await expect(
        retryMeeting("1", "2026-01-01T00:00:00.000Z", "SET #s = :s, stage = :stage, updatedAt = :u")
      ).rejects.toThrow("ConditionalCheckFailedException")
    })

    it("should propagate other errors", async () => {
      const error = new Error("Generic error")
      docClient.send.mockRejectedValueOnce(error)

      await expect(
        retryMeeting("1", "2026-01-01T00:00:00.000Z", "SET #s = :s, stage = :stage, updatedAt = :u")
      ).rejects.toThrow("Generic error")
    })
  })

  describe("rollbackRetry", () => {
    it("should call UpdateCommand to set status to failed", async () => {
      docClient.send.mockResolvedValueOnce({})

      await rollbackRetry("1", "2026-01-01T00:00:00.000Z", "Transcription failed")

      expect(docClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            UpdateExpression: "SET #s = :s, stage = :stage, errorMessage = :em, updatedAt = :u",
            ExpressionAttributeValues: expect.objectContaining({
              ":s": "failed",
              ":stage": "failed",
              ":em": "Transcription failed",
            }),
          }),
        })
      )
    })

    it("should handle empty error message", async () => {
      docClient.send.mockResolvedValueOnce({})

      await rollbackRetry("1", "2026-01-01T00:00:00.000Z", "")

      const call = docClient.send.mock.calls[0][0]
      expect(call.input.ExpressionAttributeValues[":em"]).toBe("")
    })

    it("should propagate error when send throws", async () => {
      const error = new Error("Update failed")
      docClient.send.mockRejectedValueOnce(error)

      await expect(rollbackRetry("1", "2026-01-01T00:00:00.000Z", "err")).rejects.toThrow("Update failed")
    })
  })

  describe("getGlossaryItems", () => {
    it("should return array of termIds", async () => {
      const mockItems = [{ termId: "term1" }, { termId: "term2" }]
      docClient.send.mockResolvedValueOnce({ Items: mockItems })

      const result = await getGlossaryItems()

      expect(result).toEqual(mockItems)
      expect(docClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            ProjectionExpression: "termId",
          }),
        })
      )
    })

    it("should return empty array when Items is null", async () => {
      docClient.send.mockResolvedValueOnce({ Items: null })

      const result = await getGlossaryItems()

      expect(result).toEqual([])
    })

    it("should propagate error when send throws", async () => {
      const error = new Error("Scan failed")
      docClient.send.mockRejectedValueOnce(error)

      await expect(getGlossaryItems()).rejects.toThrow("Scan failed")
    })
  })

  describe("saveReport", () => {
    it("should call PutCommand and return item", async () => {
      const mockItem = { meetingId: "1", createdAt: "2026-01-01T00:00:00.000Z", reportKey: "reports/1/report.json" }
      docClient.send.mockResolvedValueOnce({})

      const result = await saveReport(mockItem)

      expect(result).toEqual(mockItem)
      expect(docClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            TableName: process.env.DYNAMODB_TABLE,
            Item: mockItem,
          }),
        })
      )
    })

    it("should handle item with additional fields", async () => {
      const mockItem = { meetingId: "1", status: "reported", reportData: { title: "Meeting" } }
      docClient.send.mockResolvedValueOnce({})

      const result = await saveReport(mockItem)

      expect(result).toEqual(mockItem)
    })

    it("should propagate error when send throws", async () => {
      const error = new Error("Put failed")
      docClient.send.mockRejectedValueOnce(error)

      await expect(saveReport({ meetingId: "1" })).rejects.toThrow("Put failed")
    })
  })

  describe("updateMeetingReport", () => {
    it("should call UpdateCommand with correct parameters", async () => {
      docClient.send.mockResolvedValueOnce({})

      await updateMeetingReport(
        "1",
        "2026-01-01T00:00:00.000Z",
        "SET reportKey = :rk, updatedAt = :u",
        { "#rk": "reportKey" },
        { ":rk": "reports/1/report.json", ":u": "2026-01-01T00:00:00.000Z" }
      )

      expect(docClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            UpdateExpression: "SET reportKey = :rk, updatedAt = :u",
            ExpressionAttributeNames: { "#rk": "reportKey" },
          }),
        })
      )
    })

    it("should set ExpressionAttributeNames to undefined when names is null", async () => {
      docClient.send.mockResolvedValueOnce({})

      await updateMeetingReport(
        "1",
        "2026-01-01T00:00:00.000Z",
        "SET reportKey = :rk",
        null,
        { ":rk": "reports/1/report.json" }
      )

      const call = docClient.send.mock.calls[0][0]
      expect(call.input.ExpressionAttributeNames).toBeUndefined()
    })

    it("should propagate error when send throws", async () => {
      const error = new Error("Update failed")
      docClient.send.mockRejectedValueOnce(error)

      await expect(
        updateMeetingReport("1", "2026-01-01T00:00:00.000Z", "SET reportKey = :rk", {}, { ":rk": "report.json" })
      ).rejects.toThrow("Update failed")
    })
  })

  describe("markEmailSent", () => {
    it("should set stage to exporting", async () => {
      docClient.send.mockResolvedValueOnce({})

      await markEmailSent("1", "2026-01-01T00:00:00.000Z")

      expect(docClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            UpdateExpression: "SET stage = :stage, updatedAt = :u",
            ExpressionAttributeValues: expect.objectContaining({
              ":stage": "exporting",
            }),
          }),
        })
      )
    })

    it("should always update updatedAt field", async () => {
      docClient.send.mockResolvedValueOnce({})

      await markEmailSent("1", "2026-01-01T00:00:00.000Z")

      const call = docClient.send.mock.calls[0][0]
      expect(call.input.ExpressionAttributeValues[":u"]).toBeDefined()
    })

    it("should propagate error when send throws", async () => {
      const error = new Error("Update failed")
      docClient.send.mockRejectedValueOnce(error)

      await expect(markEmailSent("1", "2026-01-01T00:00:00.000Z")).rejects.toThrow("Update failed")
    })
  })

  describe("queryMeetingById", () => {
    it("should return first item when found", async () => {
      const mockItem = { meetingId: "1", createdAt: "2026-01-01T00:00:00.000Z" }
      docClient.send.mockResolvedValueOnce({ Items: [mockItem] })

      const result = await queryMeetingById("1")

      expect(result).toEqual(mockItem)
      expect(docClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            KeyConditionExpression: "meetingId = :id",
            ExpressionAttributeValues: { ":id": "1" },
            Limit: 1,
          }),
        })
      )
    })

    it("should return null when not found", async () => {
      docClient.send.mockResolvedValueOnce({ Items: [] })

      const result = await queryMeetingById("nonexistent")

      expect(result).toBeNull()
    })

    it("should propagate error when send throws", async () => {
      const error = new Error("Query failed")
      docClient.send.mockRejectedValueOnce(error)

      await expect(queryMeetingById("1")).rejects.toThrow("Query failed")
    })
  })
})
