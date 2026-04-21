"use strict";

const CATEGORY_ORDER = ["人员", "组织", "术语"];

const SECTION_HEADERS = {
  "人员": "## 人员（以下名字在转录中出现时请识别为人名，用下列标准写法）",
  "组织": "## 组织（客户/合作伙伴公司，请用下列官方称呼）",
  "术语": "## 术语（产品/技术名，请用下列规范写法）",
  "其他": "## 其他（未分类词汇，请参考使用）",
};

const DEFINITION_MAX = 30;

function truncate(text, max) {
  if (typeof text !== "string") return "";
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return trimmed.slice(0, max) + "…";
}

function parseAliases(aliases) {
  if (!aliases) return [];
  if (Array.isArray(aliases)) return aliases.filter(Boolean).map((s) => String(s).trim());
  return String(aliases)
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function renderItem(item) {
  const term = item.term;
  const def = truncate(item.definition || "", DEFINITION_MAX);
  const aliasList = parseAliases(item.aliases);
  let line = `- ${term}`;
  if (def) line += `（${def}）`;
  if (aliasList.length > 0) line += ` | 别名：${aliasList.join(", ")}`;
  return line;
}

function buildLegacyFlat(terms) {
  const list = terms.filter(Boolean).join("、");
  return `专有名词词库（请确保报告中使用正确拼写）：${list}\n\n`;
}

function buildStructuredGlossaryNote(input) {
  if (!Array.isArray(input) || input.length === 0) return "";
  if (typeof input[0] === "string") {
    return buildLegacyFlat(input);
  }

  const groups = { "人员": [], "组织": [], "术语": [], "其他": [] };
  for (const item of input) {
    const cat = item && item.category && groups[item.category] ? item.category : "其他";
    groups[cat].push(renderItem(item));
  }

  const sections = [];
  for (const cat of CATEGORY_ORDER) {
    if (groups[cat].length > 0) {
      sections.push(SECTION_HEADERS[cat] + "\n" + groups[cat].join("\n"));
    }
  }
  if (groups["其他"].length > 0) {
    sections.push(SECTION_HEADERS["其他"] + "\n" + groups["其他"].join("\n"));
  }

  if (sections.length === 0) return "";
  return "# 专有名词词库\n\n" + sections.join("\n\n") + "\n\n";
}

module.exports = { buildStructuredGlossaryNote };
