const { EC2Client, StartInstancesCommand, StopInstancesCommand, DescribeInstancesCommand } = require("@aws-sdk/client-ec2");
const { DynamoDBClient, QueryCommand } = require("@aws-sdk/client-dynamodb");
const { execFile } = require("child_process");
const { promisify } = require("util");
const logger = require("./logger");

const execFileAsync = promisify(execFile);

const INSTANCE_ID = process.env.FUNASR_INSTANCE_ID || "i-0f69617df5dc59d6b";
const FUNASR_PRIVATE_IP = process.env.FUNASR_PRIVATE_IP || "172.31.27.101";
const FUNASR_URL = process.env.FUNASR_URL || `http://${FUNASR_PRIVATE_IP}:9002`;
const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const DYNAMODB_TABLE = process.env.DYNAMODB_TABLE || "meeting-minutes-meetings";
const REGION = process.env.AWS_REGION || "us-west-2";

const ec2 = new EC2Client({ region: REGION });
const dynamoClient = new DynamoDBClient({ region: REGION });

let _lastActivityAt = null;
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
  logger.info("gpu-autoscale", "starting instance", { instanceId: INSTANCE_ID });
  await ec2.send(new StartInstancesCommand({ InstanceIds: [INSTANCE_ID] }));

  const maxAttempts = 18; // 3 min / 10s
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 10000));
    const state = await getInstanceState();
    logger.info("gpu-autoscale", "instance state", { state, attempt: i + 1, maxAttempts });
    if (state === "running") return;
  }
  throw new Error(`[gpu-autoscale] Instance ${INSTANCE_ID} did not reach 'running' within 3 minutes`);
}

// 3. stopInstance
async function stopInstance() {
  logger.info("gpu-autoscale", "stopping instance", { instanceId: INSTANCE_ID });
  await ec2.send(new StopInstancesCommand({ InstanceIds: [INSTANCE_ID] }));
  logger.info("gpu-autoscale", "stop command sent", { instanceId: INSTANCE_ID });
}

// 4. ensureReady — make sure FunASR is reachable, starting instance if needed
async function ensureReady() {
  // First, try to ping FunASR
  if (await isFunASRReachable()) {
    logger.info("gpu-autoscale", "FunASR already reachable");

    // Run preflight check before accepting transcription tasks
    await runPreflightCheck();

    return true;
  }

  // Not reachable — check instance state
  const state = await getInstanceState();
  logger.info("gpu-autoscale", "FunASR not reachable", { state });

  if (state === "stopped") {
    await startInstance();
  } else if (state === "stopping") {
    // Wait for it to fully stop, then start
    logger.info("gpu-autoscale", "instance is stopping, waiting");
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
      logger.info("gpu-autoscale", "FunASR reachable", { waitTimeSeconds: (i + 1) * 10 });

      // Run preflight check before accepting transcription tasks
      await runPreflightCheck();

      return true;
    }
    logger.info("gpu-autoscale", "waiting for FunASR HTTP", { attempt: i + 1, maxAttempts });
  }
  logger.warn("gpu-autoscale", "FunASR not reachable after 3 minutes", { url: FUNASR_URL });
  return false;
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

// Run preflight check on FunASR EC2 via SSH
async function runPreflightCheck() {
  const SSH_KEY = process.env.SSH_KEY_PATH || "/home/qiankai/.ssh/clawd-ops-20260219.pem";
  const SSH_USER = "ubuntu";
  const SSH_HOST = FUNASR_PRIVATE_IP;
  const PREFLIGHT_SCRIPT = "/home/ubuntu/preflight-check.sh";

  try {
    const { stdout, stderr } = await execFileAsync(
      "ssh",
      [
        "-i", SSH_KEY,
        "-o", "StrictHostKeyChecking=no",
        "-o", "ConnectTimeout=60",
        `${SSH_USER}@${SSH_HOST}`,
        PREFLIGHT_SCRIPT,
      ],
      { timeout: 60000 }
    );

    const output = (stdout + stderr).trim();
    logger.info("gpu-autoscale", "preflight check passed", { output });

    // Check for WARN in output
    if (output.includes("PREFLIGHT_RESULT=WARN")) {
      logger.warn("gpu-autoscale", "preflight check warning", { output });
    }
  } catch (err) {
    const output = (err.stdout || "") + (err.stderr || "");

    // Exit code 1 means FAILED
    if (err.code === 1 && output.includes("PREFLIGHT_RESULT=FAILED")) {
      logger.error("gpu-autoscale", "preflight check failed", { output, error: err.message });
      throw new Error(`[gpu-autoscale] FunASR preflight check failed: ${output}`, { cause: err });
    }

    // Other errors (SSH timeout, connection refused, etc.)
    logger.error("gpu-autoscale", "preflight check error", { error: err.message, output });
    throw new Error(`[gpu-autoscale] Failed to run preflight check: ${err.message}`, { cause: err });
  }
}

// 5. recordActivity — reset 30-min idle countdown
function recordActivity() {
  _lastActivityAt = Date.now();
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
      logger.info("gpu-autoscale", "active jobs found, deferring shutdown", { activeCount });
      recordActivity(); // reset timer
      return;
    }

    const state = await getInstanceState();
    if (state !== "running") {
      logger.info("gpu-autoscale", "instance already not running, skip shutdown", { state });
      return;
    }

    logger.info("gpu-autoscale", "no active jobs for 30 minutes, shutting down GPU instance");
    await stopInstance();
  } catch (err) {
    logger.error("gpu-autoscale", "auto-shutdown failed", { error: err.message });
  }
}

// 7. checkActiveJobs — query DynamoDB GSI for pending/processing tasks
// Only count jobs created within the last 2 hours to avoid zombie records blocking shutdown
async function checkActiveJobs() {
  try {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const [pendingResp, processingResp] = await Promise.all([
      dynamoClient.send(new QueryCommand({
        TableName: DYNAMODB_TABLE,
        IndexName: "status-createdAt-index",
        KeyConditionExpression: "#s = :pending AND createdAt >= :cutoff",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: {
          ":pending": { S: "pending" },
          ":cutoff": { S: twoHoursAgo },
        },
        Select: "COUNT",
      })),
      dynamoClient.send(new QueryCommand({
        TableName: DYNAMODB_TABLE,
        IndexName: "status-createdAt-index",
        KeyConditionExpression: "#s = :processing AND createdAt >= :cutoff",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: {
          ":processing": { S: "processing" },
          ":cutoff": { S: twoHoursAgo },
        },
        Select: "COUNT",
      })),
    ]);
    return (pendingResp.Count || 0) + (processingResp.Count || 0);
  } catch (err) {
    logger.error("gpu-autoscale", "checkActiveJobs failed", { error: err.message });
    return 1; // err on the side of caution — assume something is running
  }
}

module.exports = { ensureReady, recordActivity };
