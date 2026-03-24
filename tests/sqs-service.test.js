const mockSQSSend = jest.fn();

jest.mock("@aws-sdk/client-sqs", () => ({
  SQSClient: jest.fn(() => ({ send: mockSQSSend })),
  SendMessageCommand: jest.fn((input) => ({ input })),
  ReceiveMessageCommand: jest.fn((input) => ({ input })),
  DeleteMessageCommand: jest.fn((input) => ({ input })),
}));

const { sendMessage, receiveMessages, deleteMessage } = require("../services/sqs");

describe("sqs-service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("sendMessage", () => {
    it("should send message to queue", async () => {
      mockSQSSend.mockResolvedValueOnce({});

      await sendMessage("https://sqs.us-west-2.amazonaws.com/123/test", { foo: "bar" });

      expect(mockSQSSend).toHaveBeenCalledWith(expect.objectContaining({
        input: expect.objectContaining({
          QueueUrl: "https://sqs.us-west-2.amazonaws.com/123/test",
          MessageBody: JSON.stringify({ foo: "bar" }),
        }),
      }));
    });
  });

  describe("receiveMessages", () => {
    it("should receive messages from queue", async () => {
      const mockMessages = [{ MessageId: "1", Body: "test" }];
      mockSQSSend.mockResolvedValueOnce({ Messages: mockMessages });

      const result = await receiveMessages("https://sqs.us-west-2.amazonaws.com/123/test");

      expect(result).toEqual(mockMessages);
      expect(mockSQSSend).toHaveBeenCalledWith(expect.objectContaining({
        input: expect.objectContaining({
          QueueUrl: "https://sqs.us-west-2.amazonaws.com/123/test",
          MaxNumberOfMessages: 1,
          WaitTimeSeconds: 20,
        }),
      }));
    });

    it("should return empty array when no messages", async () => {
      mockSQSSend.mockResolvedValueOnce({});

      const result = await receiveMessages("https://sqs.us-west-2.amazonaws.com/123/test");

      expect(result).toEqual([]);
    });

    it("should support custom maxMessages", async () => {
      mockSQSSend.mockResolvedValueOnce({ Messages: [] });

      await receiveMessages("https://sqs.us-west-2.amazonaws.com/123/test", 10);

      expect(mockSQSSend).toHaveBeenCalledWith(expect.objectContaining({
        input: expect.objectContaining({
          MaxNumberOfMessages: 10,
        }),
      }));
    });
  });

  describe("deleteMessage", () => {
    it("should delete message from queue", async () => {
      mockSQSSend.mockResolvedValueOnce({});

      await deleteMessage("https://sqs.us-west-2.amazonaws.com/123/test", "receipt-handle-123");

      expect(mockSQSSend).toHaveBeenCalledWith(expect.objectContaining({
        input: expect.objectContaining({
          QueueUrl: "https://sqs.us-west-2.amazonaws.com/123/test",
          ReceiptHandle: "receipt-handle-123",
        }),
      }));
    });
  });
});
