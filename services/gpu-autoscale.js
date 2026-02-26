const { EC2Client, StartInstancesCommand, StopInstancesCommand, DescribeInstancesCommand } = require("@aws-sdk/client-ec2");
const { DynamoDBClient, ScanCommand } = require("@aws-sdk/client-dynamodb");

const INSTANCE_ID = process.env.FUNASR_INSTANCE_ID || "i-0f69617df5dc59d6b";
const FUNASR_URL = process.env.FUNASR_URL || "http://172.31.27.101:9002";
const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const DYNAMODB_TABLE = process.env.DYNAMODB_TABLE || "meeting-minutes-meetings";
const REGION = process.env.AWS_REGION || "us-west-2";

const ec2 = new EC2Client({ region: REGION });
const dynamoClient = new DynamoDBClient({ region: REGION });

let lastActivityAt = null;
let idleTimer = null;

// 1. getInstanceState
async function getInstanceState() {
  const resp = await ec2.send(new DescribeInstancesCommand({
    InstanceIds: [INSTANCE_ID],
  }));
  const instance = resp.Reservations?.[0]?.Instances?.[0];
  if (!instance) {
    throw new Error(`[gpu-autoscale] Instance ${INSTANCE_ID} not found`);
  }
  return instance.State.Name; // "running" | "stopped" | "pending" | "stopping" | ...
}

// 2. startInstance — start and poll until running (max 3 min, every 10s)
async function startInstance() {
  console.log(`[gpu-autoscale] Starting instance ${INSTANCE_ID}...`);
  await ec2.send(new StartInstancesCommand({ InstanceIds: [INSTANCE_ID] }));

  const maxAttempts = 18; // 3 min / 10s
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 10000));
    const state = await getInstanceState();
    console.log(`[gpu-autoscale] Instance state: ${state} (attempt ${i + 1}/${maxAttempts})`);
    if (state === "running") return;
  }
  throw new Error(`[gpu-autoscale] Instance ${INSTANCE_ID} did not reach 'running' within 3 minutes`);
}

// 3. stopInstance
async function stopInstance() {
  console.log(`[gpu-autoscale] Stopping instance ${INSTANCE_ID}...`);
  await ec2.send(new StopInstancesCommand({ InstanceIds: [INSTANCE_ID] }));
  console.log(`[gpu-autoscale] Stop command sent for ${INSTANCE_ID}`);
}

// 4. ensureReady — make sure FunASR is reachable, starting instance if needed
async function ensureReady() {
  // First, try to ping FunASR
  if (await isFunASRReachable()) {
    console.log("[gpu-autoscale] FunASR already reachable");
    return true;
  }

  // Not reachable — check instance state
  const state = await getInstanceState();
  console.log(`[gpu-autoscale] FunASR not reachable, instance state: ${state}`);

  if (state === "stopped") {
    await startInstance();
  } else if (state === "stopping") {
    // Wait for it to fully stop, then start
    console.log("[gpu-autoscale] Instance is stopping, waiting...");
    for (let i = 0; i < 18; i++) {
      await new Promise((r) => setTimeout(r, 10000));
      const s = await getInstanceState();
      if (s === "stopped") break;
      if (i === 17) throw new Error("[gpu-autoscale] Instance stuck in 'stopping' state");
    }
    await startInstance();
  } else if (state !== "running" && state !== "pending") {
    throw new Error(`[gpu-autoscale] Instance in unexpected state: ${state}`);
  }
  // state is "running" or "pending" — wait for HTTP reachable

  // Poll FunASR HTTP endpoint (max 3 min, every 10s)
  const maxAttempts = 18;
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 10000));
    if (await isFunASRReachable()) {
      console.log(`[gpu-autoscale] FunASR reachable after ${(i + 1) * 10}s`);
      return true;
    }
    console.log(`[gpu-autoscale] Waiting for FunASR HTTP... (attempt ${i + 1}/${maxAttempts})`);
  }
  throw new Error(`[gpu-autoscale] FunASR at ${FUNASR_URL} not reachable after 3 minutes`);
}

async function isFunASRReachable() {
  try {
    const resp = await fetch(`${FUNASR_URL}/health`, { signal: AbortSignal.timeout(5000) });
    return resp.ok;
  } catch {
    // health endpoint might not exist, try root
    try {
      const resp = await fetch(FUNASR_URL, { signal: AbortSignal.timeout(5000) });
      return resp.status < 500; // any non-server-error means it's up
    } catch {
      return false;
    }
  }
}

// 5. recordActivity — reset 30-min idle countdown
function recordActivity() {
  lastActivityAt = Date.now();
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(autoShutdown, IDLE_TIMEOUT_MS);
  // Prevent timer from keeping the process alive
  if (idleTimer.unref) idleTimer.unref();
}

// 6. autoShutdown — double-check no active jobs before stopping
async function autoShutdown() {
  try {
    const activeCount = await checkActiveJobs();
    if (activeCount > 0) {
      console.log(`[gpu-autoscale] ${activeCount} active jobs found, deferring shutdown`);
      recordActivity(); // reset timer
      return;
    }

    const state = await getInstanceState();
    if (state !== "running") {
      console.log(`[gpu-autoscale] Instance already ${state}, skip shutdown`);
      return;
    }

    console.log("[gpu-autoscale] No active jobs for 30 minutes, shutting down GPU instance");
    await stopInstance();
  } catch (err) {
    console.error("[gpu-autoscale] Auto-shutdown failed:", err.message);
  }
}

// 7. checkActiveJobs — scan DynamoDB for pending/transcribing tasks
async function checkActiveJobs() {
  try {
    const resp = await dynamoClient.send(new ScanCommand({
      TableName: DYNAMODB_TABLE,
      FilterExpression: "#s IN (:pending, :processing)",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: {
        ":pending": { S: "pending" },
        ":processing": { S: "processing" },
      },
      Select: "COUNT",
    }));
    return resp.Count || 0;
  } catch (err) {
    console.error("[gpu-autoscale] checkActiveJobs failed:", err.message);
    return 1; // err on the side of caution — assume something is running
  }
}

module.exports = { ensureReady, recordActivity };
