const { docClient } = require("../db/dynamodb")
const {
  ScanCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
} = require("@aws-sdk/lib-dynamodb")
const {
  listGlossary,
  createGlossaryItem,
  updateGlossaryItem,
  deleteGlossaryItem,
} = require("../services/glossary-store")

jest.mock("../db/dynamodb", () => ({
  docClient: { send: jest.fn() },
}))

describe("glossary-store", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe("listGlossary", () => {
    it("should return array of glossary items when Items exist", async () => {
      const mockItems = [
        { termId: "term1", term: "AWS", definition: "Amazon Web Services" },
        { termId: "term2", term: "S3", definition: "Simple Storage Service" },
      ]
      docClient.send.mockResolvedValueOnce({ Items: mockItems })

      const result = await listGlossary()

      expect(result).toEqual(mockItems)
      expect(docClient.send).toHaveBeenCalledWith(expect.any(ScanCommand))
    })

    it("should return empty array when Items is null", async () => {
      docClient.send.mockResolvedValueOnce({ Items: null })

      const result = await listGlossary()

      expect(result).toEqual([])
    })

    it("should propagate error when send throws", async () => {
      const error = new Error("DynamoDB scan error")
      docClient.send.mockRejectedValueOnce(error)

      await expect(listGlossary()).rejects.toThrow("DynamoDB scan error")
    })
  })

  describe("createGlossaryItem", () => {
    it("should call PutCommand and return item", async () => {
      const mockItem = {
        termId: "term1",
        term: "API",
        definition: "Application Programming Interface",
        createdAt: "2026-01-01T00:00:00.000Z",
      }
      docClient.send.mockResolvedValueOnce({})

      const result = await createGlossaryItem(mockItem)

      expect(result).toEqual(mockItem)
      expect(docClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            TableName: process.env.GLOSSARY_TABLE,
            Item: mockItem,
          }),
        })
      )
    })

    it("should handle item with minimal fields", async () => {
      const mockItem = { termId: "term1", term: "AWS" }
      docClient.send.mockResolvedValueOnce({})

      const result = await createGlossaryItem(mockItem)

      expect(result).toEqual(mockItem)
    })

    it("should propagate error when send throws", async () => {
      const error = new Error("Put failed")
      docClient.send.mockRejectedValueOnce(error)

      await expect(createGlossaryItem({ termId: "term1" })).rejects.toThrow("Put failed")
    })
  })

  describe("updateGlossaryItem", () => {
    it("should return Attributes from UpdateCommand", async () => {
      const mockAttributes = {
        termId: "term1",
        term: "API",
        definition: "Updated definition",
        updatedAt: "2026-01-02T00:00:00.000Z",
      }
      docClient.send.mockResolvedValueOnce({ Attributes: mockAttributes })

      const result = await updateGlossaryItem(
        "term1",
        ["#def = :def", "updatedAt = :u"],
        { "#def": "definition" },
        { ":def": "Updated definition", ":u": "2026-01-02T00:00:00.000Z" }
      )

      expect(result).toEqual(mockAttributes)
      expect(docClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            TableName: process.env.GLOSSARY_TABLE,
            Key: { termId: "term1" },
            UpdateExpression: "SET #def = :def, updatedAt = :u",
            ReturnValues: "ALL_NEW",
          }),
        })
      )
    })

    it("should set ExpressionAttributeNames to undefined when names is empty", async () => {
      docClient.send.mockResolvedValueOnce({ Attributes: {} })

      await updateGlossaryItem("term1", ["term = :t"], {}, { ":t": "NewTerm" })

      const call = docClient.send.mock.calls[0][0]
      expect(call.input.ExpressionAttributeNames).toBeUndefined()
    })

    it("should propagate error when send throws", async () => {
      const error = new Error("Update failed")
      docClient.send.mockRejectedValueOnce(error)

      await expect(
        updateGlossaryItem("term1", ["term = :t"], {}, { ":t": "NewTerm" })
      ).rejects.toThrow("Update failed")
    })
  })

  describe("deleteGlossaryItem", () => {
    it("should call DeleteCommand with correct key", async () => {
      docClient.send.mockResolvedValueOnce({})

      await deleteGlossaryItem("term1")

      expect(docClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            TableName: process.env.GLOSSARY_TABLE,
            Key: { termId: "term1" },
          }),
        })
      )
    })

    it("should be idempotent and not throw error when item does not exist", async () => {
      docClient.send.mockResolvedValueOnce({})

      await expect(deleteGlossaryItem("nonexistent")).resolves.toBeUndefined()
    })

    it("should propagate error when send throws", async () => {
      const error = new Error("Delete failed")
      docClient.send.mockRejectedValueOnce(error)

      await expect(deleteGlossaryItem("term1")).rejects.toThrow("Delete failed")
    })
  })
})
