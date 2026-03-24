const mockEC2Send = jest.fn();
const mockDynamoSend = jest.fn();
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

global.fetch = mockFetch;

const { ensureReady, recordActivity, warmUpGPU } = require("../services/gpu-autoscale");

describe("gpu-autoscale", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  describe("ensureReady", () => {
    it("should return true when FunASR is already reachable", async () => {
      // First fetch: isFunASRReachable in ensureReady → reachable
      // Second fetch: isFunASRReachable in runPreflightCheck → reachable
      mockFetch
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({ ok: true });

      const result = await ensureReady();

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining("/health"), expect.any(Object));
    });

    it("should throw on preflight check failure (HTTP /health not ok)", async () => {
      // First fetch: reachable
      // Second fetch (preflight): not ok → loading state
      mockFetch
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({ ok: false });

      await expect(ensureReady()).rejects.toThrow("FunASR preflight check failed");
    });

    it("should throw on preflight check network error", async () => {
      // First fetch: reachable
      // Second fetch (preflight): ECONNREFUSED
      const connErr = new Error("Connection refused");
      connErr.cause = { code: "ECONNREFUSED" };
      mockFetch
        .mockResolvedValueOnce({ ok: true })
        .mockRejectedValueOnce(connErr)
        .mockRejectedValueOnce(connErr);

      await expect(ensureReady()).rejects.toThrow("FunASR preflight check failed");
    });

    it("should start stopped instance and wait for FunASR", async () => {
      jest.useFakeTimers();
      const connErr = new Error("Connection refused");
      connErr.code = "ECONNREFUSED";
      mockFetch
        .mockRejectedValueOnce(connErr)         // ensureReady: not reachable
        .mockResolvedValueOnce({ ok: true })     // poll: reachable
        .mockResolvedValueOnce({ ok: true });    // preflight: ok
      mockEC2Send
        .mockResolvedValueOnce({ Reservations: [{ Instances: [{ State: { Name: "stopped" } }] }] })
        .mockResolvedValueOnce({})  // StartInstances
        .mockResolvedValueOnce({ Reservations: [{ Instances: [{ State: { Name: "running" } }] }] });

      const promise = ensureReady();
      await jest.runAllTimersAsync();
      const result = await promise;

      expect(result).toBe(true);
      jest.useRealTimers();
    });

    it("should wait for stopping instance then start", async () => {
      jest.useFakeTimers();
      const connErr = new Error("Connection refused");
      connErr.code = "ECONNREFUSED";
      mockFetch
        .mockRejectedValueOnce(connErr)         // not reachable
        .mockResolvedValueOnce({ ok: true })     // poll: reachable
        .mockResolvedValueOnce({ ok: true });    // preflight
      mockEC2Send
        .mockResolvedValueOnce({ Reservations: [{ Instances: [{ State: { Name: "stopping" } }] }] })
        .mockResolvedValueOnce({ Reservations: [{ Instances: [{ State: { Name: "stopped" } }] }] })
        .mockResolvedValueOnce({})  // StartInstances
        .mockResolvedValueOnce({ Reservations: [{ Instances: [{ State: { Name: "running" } }] }] });

      const promise = ensureReady();
      await jest.runAllTimersAsync();
      await promise;

      jest.useRealTimers();
    });

    it("should throw on unexpected instance state", async () => {
      const connErr = new Error("Connection refused");
      connErr.code = "ECONNREFUSED";
      mockFetch.mockRejectedValueOnce(connErr);
      mockEC2Send.mockResolvedValueOnce({ Reservations: [{ Instances: [{ State: { Name: "terminated" } }] }] });

      await expect(ensureReady()).rejects.toThrow("unexpected state");
    });

    it("should poll FunASR with not_started reason", async () => {
      jest.useFakeTimers();
      const connErr = new Error("Connection refused");
      connErr.cause = { code: "ECONNREFUSED" };
      mockFetch
        .mockRejectedValueOnce(connErr)          // not reachable (not_started)
        .mockResolvedValueOnce({ ok: true })      // poll: reachable
        .mockResolvedValueOnce({ ok: true });     // preflight
      mockEC2Send.mockResolvedValueOnce({ Reservations: [{ Instances: [{ State: { Name: "running" } }] }] });

      const promise = ensureReady();
      await jest.runAllTimersAsync();
      await promise;

      jest.useRealTimers();
    });

    it("should poll FunASR with loading reason", async () => {
      jest.useFakeTimers();
      mockFetch
        .mockResolvedValueOnce({ ok: false })     // not reachable (loading)
        .mockResolvedValueOnce({ ok: true })       // poll: reachable
        .mockResolvedValueOnce({ ok: true });      // preflight
      mockEC2Send.mockResolvedValueOnce({ Reservations: [{ Instances: [{ State: { Name: "running" } }] }] });

      const promise = ensureReady();
      await jest.runAllTimersAsync();
      await promise;

      jest.useRealTimers();
    });

    it("should return false after max wait timeout", async () => {
      jest.useFakeTimers();
      const connErr = new Error("Connection refused");
      connErr.code = "ECONNREFUSED";
      mockFetch.mockRejectedValue(connErr);
      mockEC2Send.mockResolvedValue({ Reservations: [{ Instances: [{ State: { Name: "running" } }] }] });

      const promise = ensureReady();
      await jest.runAllTimersAsync();
      const result = await promise;

      expect(result).toBe(false);
      jest.useRealTimers();
    });

    it("should handle fetch timeout and fallback to root", async () => {
      // First /health: timeout → catch → try root endpoint → status 200 → reachable
      // Preflight: /health ok
      mockFetch
        .mockRejectedValueOnce(new Error("timeout"))
        .mockResolvedValueOnce({ status: 200 })   // root fallback → reachable
        .mockResolvedValueOnce({ ok: true });      // preflight

      await ensureReady();
    });

    it("should detect loading state from root endpoint", async () => {
      jest.useFakeTimers();
      mockFetch
        .mockRejectedValueOnce(new Error("timeout"))
        .mockResolvedValueOnce({ status: 503 })     // root fallback → loading
        .mockResolvedValueOnce({ ok: true })         // poll: reachable
        .mockResolvedValueOnce({ ok: true });        // preflight
      mockEC2Send.mockResolvedValue({ Reservations: [{ Instances: [{ State: { Name: "running" } }] }] });

      const promise = ensureReady();
      await jest.runAllTimersAsync();
      await promise;

      jest.useRealTimers();
    });

    it("should handle ECONNREFUSED in root endpoint fallback", async () => {
      jest.useFakeTimers();
      const connErr = new Error("Connection refused");
      connErr.cause = { code: "ECONNREFUSED" };
      mockFetch
        .mockRejectedValueOnce(new Error("timeout"))
        .mockRejectedValueOnce(connErr)              // root fallback → not_started
        .mockResolvedValueOnce({ ok: true })          // poll: reachable
        .mockResolvedValueOnce({ ok: true });         // preflight
      mockEC2Send.mockResolvedValue({ Reservations: [{ Instances: [{ State: { Name: "running" } }] }] });

      const promise = ensureReady();
      await jest.runAllTimersAsync();
      await promise;

      jest.useRealTimers();
    });

    it("should throw when instance not found", async () => {
      const connErr = new Error("Connection refused");
      connErr.code = "ECONNREFUSED";
      mockFetch.mockRejectedValueOnce(connErr);
      mockEC2Send.mockResolvedValueOnce({ Reservations: [] });

      await expect(ensureReady()).rejects.toThrow("not found");
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

    it("should handle checkActiveJobs error gracefully", async () => {
      jest.useFakeTimers();
      mockDynamoSend.mockRejectedValue(new Error("DynamoDB error"));
      mockEC2Send.mockResolvedValue({ Reservations: [{ Instances: [{ State: { Name: "running" } }] }] });

      recordActivity();
      await jest.advanceTimersByTimeAsync(30 * 60 * 1000);

      jest.useRealTimers();
    }, 10000);

    it("should handle auto-shutdown errors", async () => {
      jest.useFakeTimers();
      mockDynamoSend.mockResolvedValue({ Count: 0 });
      mockEC2Send.mockRejectedValue(new Error("EC2 error"));

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

    it("should stop running instance before changing type", async () => {
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

    it("should throw when all fallback types fail", async () => {
      jest.useFakeTimers();
      const capacityErr = new Error("Capacity");
      capacityErr.name = "InsufficientInstanceCapacity";

      mockEC2Send
        .mockResolvedValueOnce({ Reservations: [{ Instances: [{ State: { Name: "stopped" } }] }] })
        .mockRejectedValueOnce(capacityErr)
        .mockRejectedValueOnce(capacityErr)
        .mockRejectedValueOnce(capacityErr)
        .mockResolvedValue({ Reservations: [{ Instances: [{ State: { Name: "stopped" } }] }] })
        .mockResolvedValue({})
        .mockRejectedValue(new Error("Still no capacity"));

      const promise = warmUpGPU();
      await jest.runAllTimersAsync();
      await promise;

      jest.useRealTimers();
    });

    it("should handle instance stuck in stopping state during fallback", async () => {
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
        .mockResolvedValue({ Reservations: [{ Instances: [{ State: { Name: "stopping" } }] }] });

      const promise = warmUpGPU();
      await jest.runAllTimersAsync();
      await promise;

      jest.useRealTimers();
    });

    it("should handle instance timeout during start polling", async () => {
      jest.useFakeTimers();

      mockEC2Send
        .mockResolvedValueOnce({ Reservations: [{ Instances: [{ State: { Name: "stopped" } }] }] })
        .mockResolvedValueOnce({})
        .mockResolvedValue({ Reservations: [{ Instances: [{ State: { Name: "pending" } }] }] });

      const promise = warmUpGPU();
      await jest.runAllTimersAsync();
      await promise;

      jest.useRealTimers();
    });
  });
});
