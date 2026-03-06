const { docClient } = require("../db/dynamodb");
const {
  ScanCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
} = require("@aws-sdk/lib-dynamodb");

const TABLE = process.env.GLOSSARY_TABLE;

async function listGlossary() {
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

async function createGlossaryItem(item) {
  await docClient.send(new PutCommand({ TableName: TABLE, Item: item }));
  return item;
}

async function updateGlossaryItem(termId, expressions, names, values) {
  const { Attributes } = await docClient.send(new UpdateCommand({
    TableName: TABLE,
    Key: { termId },
    UpdateExpression: `SET ${expressions.join(", ")}`,
    ExpressionAttributeNames: Object.keys(names).length ? names : undefined,
    ExpressionAttributeValues: values,
    ReturnValues: "ALL_NEW",
  }));
  return Attributes;
}

async function deleteGlossaryItem(termId) {
  await docClient.send(new DeleteCommand({
    TableName: TABLE,
    Key: { termId },
  }));
}

module.exports = {
  listGlossary,
  createGlossaryItem,
  updateGlossaryItem,
  deleteGlossaryItem,
};
