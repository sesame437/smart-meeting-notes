const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");

const s3 = new S3Client({ region: process.env.AWS_REGION });
const BUCKET = process.env.S3_BUCKET;
const PREFIX = process.env.S3_PREFIX;

async function uploadFile(key, body, contentType) {
  const fullKey = `${PREFIX}/${key}`;
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: fullKey,
    Body: body,
    ContentType: contentType,
  }));
  return key;
}

async function getFile(key) {
  const fullKey = key.startsWith(PREFIX) ? key : `${PREFIX}/${key}`;
  const resp = await s3.send(new GetObjectCommand({
    Bucket: BUCKET,
    Key: fullKey,
  }));
  return resp.Body;
}

async function deleteObject(key) {
  if (!key) return;
  const fullKey = key.startsWith(PREFIX) ? key : `${PREFIX}/${key}`;
  await s3.send(new DeleteObjectCommand({
    Bucket: BUCKET,
    Key: fullKey,
  }));
}

async function uploadStream(key, stream, contentType) {
  const fullKey = `${PREFIX}/${key}`;
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: fullKey,
    Body: stream,
    ContentType: contentType,
  }));
  return key;
}

module.exports = { s3, uploadFile, getFile, deleteObject, uploadStream };

/**
 * 使用规范（重要）：
 *
 * - uploadFile(key, body, contentType)
 *   传裸 key（不带 PREFIX），内部自动加前缀存入 S3，返回裸 key。
 *   调用方存入 DynamoDB 时直接用裸 key，不要再拼 PREFIX。
 *
 * - getFile(key)
 *   传裸 key，内部自动补 PREFIX 后读取。
 *
 * 严禁在业务代码（routes/workers）中手动拼 `${PREFIX}/...` 或 `meeting-minutes/...`。
 * 所有 PREFIX 处理统一在本文件内完成（单一职责）。
 *
 * 背景：2026-02-27 因 key 格式不一致导致 S3 Event 去重失败，统一规范后修复。
 */
