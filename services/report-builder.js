/**
 * Repair unescaped double quotes inside JSON string values.
 * LLMs often output raw " inside strings (e.g. 核心逻辑是"谁") instead of \".
 * Uses a state machine: when inside a string and encountering a ", checks if the
 * next non-whitespace char is a JSON structural token (: , } ]). If so, it's a
 * closing quote; otherwise it's an unescaped inner quote that gets escaped.
 */
function repairJsonQuotes(text) {
  let result = "";
  let inString = false;
  let escapeNext = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (escapeNext) {
      result += ch;
      escapeNext = false;
      continue;
    }

    if (ch === "\\") {
      result += ch;
      escapeNext = true;
      continue;
    }

    if (ch === '"') {
      if (!inString) {
        inString = true;
        result += ch;
      } else {
        let j = i + 1;
        while (j < text.length && " \t\r\n".includes(text[j])) j++;
        const next = text[j];
        if (
          next === ":" || next === "," || next === "}" || next === "]" ||
          next === '"' || j >= text.length
        ) {
          inString = false;
          result += ch;
        } else {
          result += '\\"';
        }
      }
    } else {
      result += ch;
    }
  }

  return result;
}

/**
 * Extract and parse JSON from LLM response text
 * Handles JSON wrapped in markdown code blocks or embedded in text
 * Robust to control characters, unescaped newlines, and unescaped quotes
 */
function extractJsonFromLLMResponse(text) {
  if (!text || typeof text !== "string") {
    throw new Error("Invalid input: text must be a non-empty string");
  }

  // Step 1: Try to extract JSON from markdown code block
  const codeBlockMatch = text.match(/```json\n?([\s\S]*?)\n?```/);
  let jsonCandidate = codeBlockMatch ? codeBlockMatch[1] : null;

  // Step 2: If no code block, try to extract raw JSON object
  if (!jsonCandidate) {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Failed to parse Bedrock JSON response: no JSON object found");
    }
    jsonCandidate = jsonMatch[0];
  }

  // Step 3: Try direct parse first
  try {
    return JSON.parse(jsonCandidate);
  } catch (_err) {
    // Direct parse failed, try cleanup
  }

  // Step 4: Strip control characters and collapse newlines to spaces
  // eslint-disable-next-line no-control-regex
  let cleaned = jsonCandidate.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
  cleaned = cleaned.replace(/\r?\n/g, " ");

  try {
    return JSON.parse(cleaned);
  } catch (_err) {
    // Still failing, try repairing unescaped quotes
  }

  // Step 5: Repair unescaped double quotes inside string values
  try {
    return JSON.parse(repairJsonQuotes(cleaned));
  } catch (repairErr) {
    throw new Error(`Failed to parse Bedrock JSON response: ${repairErr.message}`, { cause: repairErr });
  }
}

module.exports = {
  extractJsonFromLLMResponse,
  repairJsonQuotes,
};
