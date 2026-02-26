"use strict";

const fs = require("fs");
const path = require("path");

function parseQuotedStrings(content) {
  return Array.from(content.matchAll(/"([^"]+)"/g)).map((m) => m[1]);
}

describe("OGG upload whitelist validation", () => {
  const appJs = fs.readFileSync(path.join(__dirname, "../public/js/app.js"), "utf8");

  test("validTypes 包含 audio/ogg", () => {
    const validTypesBlock = appJs.match(/const validTypes\s*=\s*\[([\s\S]*?)\];/);
    expect(validTypesBlock).toBeTruthy();
    const values = parseQuotedStrings(validTypesBlock[1]);
    expect(values).toContain("audio/ogg");
  });

  test("validTypes 兼容 application/ogg", () => {
    const validTypesBlock = appJs.match(/const validTypes\s*=\s*\[([\s\S]*?)\];/);
    expect(validTypesBlock).toBeTruthy();
    const values = parseQuotedStrings(validTypesBlock[1]);
    expect(values).toContain("application/ogg");
  });

  test("ext 白名单包含 ogg", () => {
    const extBlock = appJs.match(/!\[([\s\S]*?)\]\.includes\(ext\)/);
    expect(extBlock).toBeTruthy();
    const values = parseQuotedStrings(extBlock[1]);
    expect(values).toContain("ogg");
  });
});
