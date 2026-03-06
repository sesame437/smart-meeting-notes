const { docClient } = require("../db/dynamodb");
const {
  ScanCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  QueryCommand,
} = require("@aws-sdk/lib-dynamodb");

const TABLE = process.env.DYNAMODB_TABLE;
const GLOSSARY_TABLE = process.env.GLOSSARY_TABLE || process.env.DYNAMODB_TABLE;

async function listMeetings() {
  const items = [];
  let lastKey;
  do {
    const params = {
      TableName: TABLE,
    };
    if (lastKey) params.ExclusiveStartKey = lastKey;
    const resp = await docClient.send(new ScanCommand(params));
    items.push(...(resp.Items || []));
    lastKey = resp.LastEvaluatedKey;
  } while (lastKey);
  return items;
}

async function createMeeting(item) {
  await docClient.send(new PutCommand({ TableName: TABLE, Item: item }));
  return item;
}

async function updateMeeting(meetingId, createdAt, expressions, names, values) {
  const { Attributes } = await docClient.send(new UpdateCommand({
    TableName: TABLE,
    Key: { meetingId, createdAt },
    UpdateExpression: `SET ${expressions.join(", ")}`,
    ExpressionAttributeNames: Object.keys(names).length ? names : undefined,
    ExpressionAttributeValues: values,
    ReturnValues: "ALL_NEW",
  }));
  return Attributes;
}

async function deleteMeeting(meetingId, createdAt) {
  await docClient.send(new DeleteCommand({
    TableName: TABLE,
    Key: { meetingId, createdAt },
  }));
}

async function createMeetingFromUpload(item) {
  await docClient.send(new PutCommand({ TableName: TABLE, Item: item }));
  return item;
}

async function retryMeeting(meetingId, createdAt, updateExpr) {
  await docClient.send(new UpdateCommand({
    TableName: TABLE,
    Key: { meetingId, createdAt },
    UpdateExpression: updateExpr,
    ConditionExpression: "#s = :failed",
    ExpressionAttributeNames: { "#s": "status" },
    ExpressionAttributeValues: {
      ":s": "processing",
      ":stage": "transcribing",
      ":u": new Date().toISOString(),
      ":failed": "failed",
    },
  }));
}

async function rollbackRetry(meetingId, createdAt, errorMessage) {
  await docClient.send(new UpdateCommand({
    TableName: TABLE,
    Key: { meetingId, createdAt },
    UpdateExpression: "SET #s = :s, stage = :stage, errorMessage = :em, updatedAt = :u",
    ExpressionAttributeNames: { "#s": "status" },
    ExpressionAttributeValues: {
      ":s": "failed",
      ":stage": "failed",
      ":em": errorMessage,
      ":u": new Date().toISOString(),
    },
  }));
}

async function getGlossaryItems() {
  const items = [];
  let lastKey;
  do {
    const params = {
      TableName: GLOSSARY_TABLE,
      ProjectionExpression: "termId",
    };
    if (lastKey) params.ExclusiveStartKey = lastKey;
    const resp = await docClient.send(new ScanCommand(params));
    items.push(...(resp.Items || []));
    lastKey = resp.LastEvaluatedKey;
  } while (lastKey);
  return items;
}

async function saveReport(item) {
  await docClient.send(new PutCommand({
    TableName: TABLE,
    Item: item,
  }));
  return item;
}

async function updateMeetingReport(meetingId, createdAt, updateExpr, names, values) {
  await docClient.send(new UpdateCommand({
    TableName: TABLE,
    Key: { meetingId, createdAt },
    UpdateExpression: updateExpr,
    ExpressionAttributeNames: Object.keys(names || {}).length ? names : undefined,
    ExpressionAttributeValues: values,
  }));
}

async function markEmailSent(meetingId, createdAt) {
  await docClient.send(new UpdateCommand({
    TableName: TABLE,
    Key: { meetingId, createdAt },
    UpdateExpression: "SET stage = :stage, updatedAt = :u",
    ExpressionAttributeValues: {
      ":stage": "exporting",
      ":u": new Date().toISOString(),
    },
  }));
}

async function queryMeetingById(id) {
  const { Items } = await docClient.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: "meetingId = :id",
    ExpressionAttributeValues: {
      ":id": id,
    },
    Limit: 1,
  }));
  return Items?.[0] || null;
}

module.exports = {
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
};
