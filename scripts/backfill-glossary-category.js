#!/usr/bin/env node
/**
 * One-time migration: backfill `category` field for all glossary items.
 *
 * Usage:
 *   node scripts/backfill-glossary-category.js --dry-run   # preview changes
 *   node scripts/backfill-glossary-category.js              # apply changes
 */

const { DynamoDBClient } = require("@aws-sdk/client-dynamodb")
const { DynamoDBDocumentClient, ScanCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb")

const REGION = process.env.AWS_REGION || "us-west-2"
const TABLE = process.env.GLOSSARY_TABLE || "meeting-minutes-glossary"

const client = new DynamoDBClient({ region: REGION })
const docClient = DynamoDBDocumentClient.from(client)

const dryRun = process.argv.includes("--dry-run")

// Explicit mapping: term -> category (all 63 items)
const CATEGORY_MAP = {
  // 人员 (28)
  "黄超": "人员",
  "李丞驰": "人员",
  "何培培": "人员",
  "杨志浩": "人员",
  "徐民": "人员",
  "钱进": "人员",
  "李龙": "人员",
  "梁睿": "人员",
  "陈映初": "人员",
  "孔帅": "人员",
  "钱凯": "人员",
  "郭韧": "人员",
  "Alex Xiao": "人员",
  "张芙蓉": "人员",
  "宋孜攀": "人员",
  "郁磊": "人员",
  "孙大木": "人员",
  "张强": "人员",
  "Damon Deng": "人员",
  "冯源": "人员",
  "江琦": "人员",
  "张嘉缘": "人员",
  "黄俊杰": "人员",
  "Jason X": "人员",
  "陈达": "人员",
  "马立博": "人员",
  "王佩佳": "人员",
  "魏一博": "人员",

  // 组织 (13)
  "Walltech": "组织",
  "强生": "组织",
  "万邑通": "组织",
  "金风": "组织",
  "Johnson & Johnson": "组织",
  "罗氏": "组织",
  "爱齐科技": "组织",
  "富兰瓦时": "组织",
  "和铂科技": "组织",
  "疆海": "组织",
  "硅基流动": "组织",
  "LingoAce": "组织",
  "Takeda": "组织",

  // 术语 (22)
  "ParallelCluster": "术语",
  "AgentCore": "术语",
  "H20": "术语",
  "veeva": "术语",
  "SFDC": "术语",
  "CI": "术语",
  "GAM": "术语",
  "GenAI": "术语",
  "SA": "术语",
  "SSA": "术语",
  "Quick Suite": "术语",
  "SA Activty": "术语",
  "NexusAI": "术语",
  "CSM": "术语",
  "HCLS": "术语",
  "H200": "术语",
  "MDI": "术语",
  "openclaw": "术语",
  "Claude Code": "术语",
  "AIDLC": "术语",
  "Bedrock": "术语",
  "MCS": "术语",
}

async function scanAll() {
  const items = []
  let lastKey
  do {
    const params = { TableName: TABLE }
    if (lastKey) params.ExclusiveStartKey = lastKey
    const resp = await docClient.send(new ScanCommand(params))
    items.push(...(resp.Items || []))
    lastKey = resp.LastEvaluatedKey
  } while (lastKey)
  return items
}

async function run() {
  console.log(`Mode: ${dryRun ? "DRY RUN" : "LIVE"}`)
  console.log(`Table: ${TABLE}  Region: ${REGION}\n`)

  const items = await scanAll()
  console.log(`Total items scanned: ${items.length}\n`)

  let updated = 0
  let skipped = 0
  let unmapped = 0

  for (const item of items) {
    const term = item.term
    const termId = item.termId

    // Skip items that already have a category
    if (item.category) {
      console.log(`  SKIP (already set) ${term} -> ${item.category}`)
      skipped++
      continue
    }

    const category = CATEGORY_MAP[term]
    if (!category) {
      console.log(`  UNMAPPED: "${term}" (termId: ${termId}) — not in CATEGORY_MAP`)
      unmapped++
      continue
    }

    if (dryRun) {
      console.log(`  WOULD SET ${term} -> ${category}`)
    } else {
      await docClient.send(
        new UpdateCommand({
          TableName: TABLE,
          Key: { termId },
          UpdateExpression: "SET category = :c",
          ExpressionAttributeValues: { ":c": category },
        })
      )
      console.log(`  UPDATED ${term} -> ${category}`)
    }
    updated++
  }

  console.log("\n--- Summary ---")
  console.log(`Total scanned: ${items.length}`)
  console.log(`${dryRun ? "Would update" : "Updated"}: ${updated}`)
  console.log(`Skipped (already set): ${skipped}`)
  if (unmapped > 0) {
    console.log(`Unmapped (no match in CATEGORY_MAP): ${unmapped}`)
  }
}

run().catch((err) => {
  console.error("Migration failed:", err.message)
  process.exit(1)
})
