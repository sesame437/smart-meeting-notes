/**
 * Extract and parse JSON from LLM response text
 * Handles JSON wrapped in markdown code blocks or embedded in text
 * Robust to control characters and unescaped newlines in CJK content
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
  } catch (err) {
    // Direct parse failed, try cleanup
  }

  // Step 4: Clean up and retry
  try {
    // Remove control characters except \n, \r, \t
    let cleaned = jsonCandidate.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");

    // Fix unescaped newlines inside string values
    // This is tricky - we need to escape newlines that are inside quotes
    // A simple heuristic: replace literal newlines with \\n
    // (This may not be perfect for all cases, but handles most CJK content issues)
    cleaned = cleaned.replace(/([^\\])\n/g, "$1\\n");

    return JSON.parse(cleaned);
  } catch (cleanupErr) {
    throw new Error(`Failed to parse Bedrock JSON response: ${cleanupErr.message}`);
  }
}

module.exports = {
  extractJsonFromLLMResponse,
};
