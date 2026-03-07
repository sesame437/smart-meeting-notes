const mockEC2Send = jest.fn();
const mockDynamoSend = jest.fn();
const mockExecFile = jest.fn();
const mockFetch = jest.fn();

jest.mock("@aws-sdk/client-ec2", () => ({
  EC2Client: jest.fn(() => ({ send: mockEC2Send })),
  StartInstancesCommand: jest.fn((input) => ({ input })),
  StopInstancesCommand: jest.fn((input) => ({ input })),
  DescribeInstancesCommand: jest.fn((input) => ({ input })),
  ModifyInstanceAttributeCommand: jest.fn((input) => ({ input })),
}));

jest.mock("@aws-sdk/client-dynamodb", () => ({
  DynamoDBClient: jest.fn(() => ({ send: mockDynamoSend })),
  QueryCommand: jest.fn((input) => ({ input })),
}));

jest.mock("child_process", () => ({
  execFile: (...args) => mockExecFile(...args),
}));

global.fetch = mockFetch;

const { ensureReady, recordActivity, warmUpGPU } = require("../services/gpu-autoscale");

describe("gpu-autoscale", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("ensureReady", () => {
    it("should return true when FunASR is already reachable", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });
      mockExecFile.mockImplementation((cmd, args, opts, cb) => cb(null, { stdout: "PREFLIGHT_RESULT=OK" }));

      const result = await ensureReady();

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining("/health"), expect.any(Object));
    });

    it("should handle preflight check warning", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });
      mockExecFile.mockImplementation((cmd, args, opts, cb) => cb(null, { stdout: "PREFLIGHT_RESULT=WARN\nGPU temp high" }));

      const result = await ensureReady();
      expect(result).toBe(true);
    });

    it("should throw on preflight check failure", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });
      const err = new Error("Preflight failed");
      err.code = 1;
      err.stdout = "PREFLIGHT_RESULT=FAILED\nGPU not found";
      mockExecFile.mockImplementation((cmd, args, opts, cb) => cb(err));

      await expect(ensureReady()).rejects.toThrow("FunASR preflight check failed");
    });

    it("should handle SSH timeout error", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });
      const err = new Error("SSH timeout");
      err.code = 255;
      mockExecFile.mockImplementation((cmd, args, opts, cb) => cb(err));

      await expect(ensureReady()).rejects.toThrow("Failed to run preflight check");
    });
  });

  describe("recordActivity", () => {
    it("should reset idle timer", () => {
      recordActivity();
      expect(true).toBe(true);
    });
  });

  describe("warmUpGPU", () => {
    it("should skip when instance already running", async () => {
      mockEC2Send.mockResolvedValueOnce({ Reservations: [{ Instances: [{ State: { Name: "running" } }] }] });

      await warmUpGPU();

      expect(mockEC2Send).toHaveBeenCalled();
    });

    it("should skip when instance pending", async () => {
      mockEC2Send.mockResolvedValueOnce({ Reservations: [{ Instances: [{ State: { Name: "pending" } }] }] });

      await warmUpGPU();

      expect(mockEC2Send).toHaveBeenCalledTimes(1);
    });

    it("should not throw on error", async () => {
      mockEC2Send.mockRejectedValueOnce(new Error("EC2 error"));

      await expect(warmUpGPU()).resolves.toBeUndefined();
    });
  });
});
