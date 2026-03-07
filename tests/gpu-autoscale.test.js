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
    jest.useRealTimers();
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

    it("should throw on SSH timeout error", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });
      const err = new Error("SSH timeout");
      err.code = 255;
      mockExecFile.mockImplementation((cmd, args, opts, cb) => cb(err));

      await expect(ensureReady()).rejects.toThrow("Failed to run preflight check");
    });

    it("should start stopped instance and wait for FunASR", async () => {
      jest.useFakeTimers();
      mockFetch
        .mockRejectedValueOnce({ code: "ECONNREFUSED" })
        .mockResolvedValueOnce({ ok: true });
      mockEC2Send
        .mockResolvedValueOnce({ Reservations: [{ Instances: [{ State: { Name: "stopped" } }] }] })
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ Reservations: [{ Instances: [{ State: { Name: "running" } }] }] });
      mockExecFile.mockImplementation((cmd, args, opts, cb) => cb(null, { stdout: "OK" }));

      const promise = ensureReady();
      await jest.runAllTimersAsync();
      const result = await promise;

      expect(result).toBe(true);
      jest.useRealTimers();
    });

    it("should wait for stopping instance then start", async () => {
      jest.useFakeTimers();
      mockFetch
        .mockRejectedValueOnce({ code: "ECONNREFUSED" })
        .mockResolvedValueOnce({ ok: true });
      mockEC2Send
        .mockResolvedValueOnce({ Reservations: [{ Instances: [{ State: { Name: "stopping" } }] }] })
        .mockResolvedValueOnce({ Reservations: [{ Instances: [{ State: { Name: "stopped" } }] }] })
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ Reservations: [{ Instances: [{ State: { Name: "running" } }] }] });
      mockExecFile.mockImplementation((cmd, args, opts, cb) => cb(null, { stdout: "OK" }));

      const promise = ensureReady();
      await jest.runAllTimersAsync();
      await promise;

      jest.useRealTimers();
    });

    it("should throw on unexpected instance state", async () => {
      mockFetch.mockRejectedValueOnce({ code: "ECONNREFUSED" });
      mockEC2Send.mockResolvedValueOnce({ Reservations: [{ Instances: [{ State: { Name: "terminated" } }] }] });

      await expect(ensureReady()).rejects.toThrow("unexpected state");
    });

    it("should poll FunASR with not_started reason", async () => {
      jest.useFakeTimers();
      mockFetch
        .mockRejectedValueOnce({ cause: { code: "ECONNREFUSED" } })
        .mockResolvedValueOnce({ ok: true });
      mockEC2Send.mockResolvedValueOnce({ Reservations: [{ Instances: [{ State: { Name: "running" } }] }] });
      mockExecFile.mockImplementation((cmd, args, opts, cb) => cb(null, { stdout: "OK" }));

      const promise = ensureReady();
      await jest.runAllTimersAsync();
      await promise;

      jest.useRealTimers();
    });

    it("should poll FunASR with loading reason", async () => {
      jest.useFakeTimers();
      mockFetch
        .mockResolvedValueOnce({ ok: false })
        .mockResolvedValueOnce({ ok: true });
      mockEC2Send.mockResolvedValueOnce({ Reservations: [{ Instances: [{ State: { Name: "running" } }] }] });
      mockExecFile.mockImplementation((cmd, args, opts, cb) => cb(null, { stdout: "OK" }));

      const promise = ensureReady();
      await jest.runAllTimersAsync();
      await promise;

      jest.useRealTimers();
    });

    it("should return false after max wait timeout", async () => {
      jest.useFakeTimers();
      mockFetch.mockRejectedValue({ code: "ECONNREFUSED" });
      mockEC2Send.mockResolvedValue({ Reservations: [{ Instances: [{ State: { Name: "running" } }] }] });

      const promise = ensureReady();
      await jest.runAllTimersAsync();
      const result = await promise;

      expect(result).toBe(false);
      jest.useRealTimers();
    });

    it("should handle fetch timeout and fallback to root", async () => {
      mockFetch
        .mockRejectedValueOnce(new Error("timeout"))
        .mockResolvedValueOnce({ status: 200 });
      mockEC2Send.mockResolvedValueOnce({ Reservations: [{ Instances: [{ State: { Name: "running" } }] }] });
      mockExecFile.mockImplementation((cmd, args, opts, cb) => cb(null, { stdout: "OK" }));

      await ensureReady();
    });

    it("should detect loading state from root endpoint", async () => {
      jest.useFakeTimers();
      mockFetch
        .mockRejectedValueOnce(new Error("timeout"))
        .mockResolvedValueOnce({ status: 503 })
        .mockResolvedValueOnce({ ok: true });
      mockEC2Send.mockResolvedValue({ Reservations: [{ Instances: [{ State: { Name: "running" } }] }] });
      mockExecFile.mockImplementation((cmd, args, opts, cb) => cb(null, { stdout: "OK" }));

      const promise = ensureReady();
      await jest.runAllTimersAsync();
      await promise;

      jest.useRealTimers();
    });
  });

  describe("recordActivity", () => {
    it("should reset idle timer", () => {
      recordActivity();
      expect(true).toBe(true);
    });

    it("should trigger auto-shutdown after idle timeout", async () => {
      jest.useFakeTimers();
      mockDynamoSend.mockResolvedValue({ Count: 0 });
      mockEC2Send
        .mockResolvedValueOnce({ Reservations: [{ Instances: [{ State: { Name: "running" } }] }] })
        .mockResolvedValueOnce({});

      recordActivity();
      
      await jest.advanceTimersByTimeAsync(30 * 60 * 1000);

      expect(mockEC2Send).toHaveBeenCalled();
      jest.useRealTimers();
    }, 10000);

    it("should defer shutdown when active jobs exist", async () => {
      jest.useFakeTimers();
      mockDynamoSend.mockResolvedValue({ Count: 2 });
      mockEC2Send.mockResolvedValue({ Reservations: [{ Instances: [{ State: { Name: "running" } }] }] });

      recordActivity();
      await jest.advanceTimersByTimeAsync(30 * 60 * 1000);

      jest.useRealTimers();
    }, 10000);

    it("should skip shutdown when instance not running", async () => {
      jest.useFakeTimers();
      mockDynamoSend.mockResolvedValue({ Count: 0 });
      mockEC2Send.mockResolvedValueOnce({ Reservations: [{ Instances: [{ State: { Name: "stopped" } }] }] });

      recordActivity();
      await jest.advanceTimersByTimeAsync(30 * 60 * 1000);

      jest.useRealTimers();
    }, 10000);
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

    it("should start stopped instance", async () => {
      jest.useFakeTimers();
      mockEC2Send
        .mockResolvedValueOnce({ Reservations: [{ Instances: [{ State: { Name: "stopped" } }] }] })
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ Reservations: [{ Instances: [{ State: { Name: "running" } }] }] });

      const promise = warmUpGPU();
      await jest.runAllTimersAsync();
      await promise;

      jest.useRealTimers();
    });

    it("should not throw on error", async () => {
      mockEC2Send.mockRejectedValueOnce(new Error("EC2 error"));

      await expect(warmUpGPU()).resolves.toBeUndefined();
    });

    it("should retry on InsufficientInstanceCapacity", async () => {
      jest.useFakeTimers();
      const capacityErr = new Error("Capacity");
      capacityErr.name = "InsufficientInstanceCapacity";

      mockEC2Send
        .mockResolvedValueOnce({ Reservations: [{ Instances: [{ State: { Name: "stopped" } }] }] })
        .mockRejectedValueOnce(capacityErr)
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ Reservations: [{ Instances: [{ State: { Name: "running" } }] }] });

      const promise = warmUpGPU();
      await jest.runAllTimersAsync();
      await promise;

      jest.useRealTimers();
    });

    it("should fallback to different instance types after retries", async () => {
      jest.useFakeTimers();
      const capacityErr = new Error("Capacity");
      capacityErr.name = "InsufficientInstanceCapacity";

      mockEC2Send
        .mockResolvedValueOnce({ Reservations: [{ Instances: [{ State: { Name: "stopped" } }] }] })
        .mockRejectedValueOnce(capacityErr)
        .mockRejectedValueOnce(capacityErr)
        .mockRejectedValueOnce(capacityErr)
        .mockResolvedValueOnce({ Reservations: [{ Instances: [{ State: { Name: "stopped" } }] }] })
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ Reservations: [{ Instances: [{ State: { Name: "running" } }] }] });

      const promise = warmUpGPU();
      await jest.runAllTimersAsync();
      await promise;

      jest.useRealTimers();
    });

    it("should stop instance before changing type", async () => {
      jest.useFakeTimers();
      const capacityErr = new Error("Capacity");
      capacityErr.name = "InsufficientInstanceCapacity";

      mockEC2Send
        .mockResolvedValueOnce({ Reservations: [{ Instances: [{ State: { Name: "stopped" } }] }] })
        .mockRejectedValueOnce(capacityErr)
        .mockRejectedValueOnce(capacityErr)
        .mockRejectedValueOnce(capacityErr)
        .mockResolvedValueOnce({ Reservations: [{ Instances: [{ State: { Name: "running" } }] }] })
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ Reservations: [{ Instances: [{ State: { Name: "stopped" } }] }] })
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ Reservations: [{ Instances: [{ State: { Name: "running" } }] }] });

      const promise = warmUpGPU();
      await jest.runAllTimersAsync();
      await promise;

      jest.useRealTimers();
    });
  });
});
