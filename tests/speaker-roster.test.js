"use strict";

const {
  collectSpeakerAliasMap,
  buildSpeakerRoster,
  replaceNameAlias,
  normalizeDuplicateNames,
  applyGlossaryAliases,
  isIgnorableAliasFragment,
} = require("../services/speaker-roster");

describe("isIgnorableAliasFragment", () => {
  test("returns true for SPEAKER_ keys", () => {
    expect(isIgnorableAliasFragment("SPEAKER_0")).toBe(true);
    expect(isIgnorableAliasFragment("SPEAKER_12")).toBe(true);
  });

  test("returns true for generic role terms", () => {
    expect(isIgnorableAliasFragment("团队")).toBe(true);
    expect(isIgnorableAliasFragment("负责人")).toBe(true);
    expect(isIgnorableAliasFragment("SA")).toBe(true);
  });

  test("returns false for name-like strings", () => {
    expect(isIgnorableAliasFragment("张三")).toBe(false);
    expect(isIgnorableAliasFragment("Alice")).toBe(false);
  });

  test("returns true for empty/null", () => {
    expect(isIgnorableAliasFragment("")).toBe(true);
    expect(isIgnorableAliasFragment(null)).toBe(true);
  });
});

describe("collectSpeakerAliasMap", () => {
  test("maps participant aliases to real names", () => {
    const participants = ["主持人（SPEAKER_0）"];
    const nameMap = { SPEAKER_0: "Alice" };
    const result = collectSpeakerAliasMap(participants, nameMap);
    expect(result["主持人"]).toBe("Alice");
    expect(result["主持人（SPEAKER_0）"]).toBe("Alice");
  });

  test("uses savedSpeakerAliases when provided", () => {
    const nameMap = { SPEAKER_1: "Bob" };
    const savedAliases = { SPEAKER_1: ["成员A", "参会人 2"] };
    const result = collectSpeakerAliasMap([], nameMap, savedAliases);
    expect(result["成员A"]).toBe("Bob");
    expect(result["参会人 2"]).toBe("Bob");
  });

  test("uses existing roster entries", () => {
    const nameMap = { SPEAKER_0: "Charlie" };
    const roster = [{
      speakerKey: "SPEAKER_0",
      displayLabel: "参会人 1",
      possibleName: "成员X",
      aliases: ["成员X"],
    }];
    const result = collectSpeakerAliasMap([], nameMap, {}, roster);
    expect(result["成员X"]).toBe("Charlie");
    expect(result["参会人 1"]).toBe("Charlie");
  });
});

describe("buildSpeakerRoster", () => {
  test("builds roster from speakerKeypoints", () => {
    const report = {
      speakerKeypoints: { SPEAKER_0: ["开场"], SPEAKER_1: ["汇报"] },
    };
    const nameMap = { SPEAKER_0: "Alice", SPEAKER_1: "Bob" };
    const roster = buildSpeakerRoster(report, nameMap);

    expect(roster).toHaveLength(2);
    expect(roster[0]).toMatchObject({
      speakerKey: "SPEAKER_0",
      resolvedName: "Alice",
      displayLabel: "参会人 1",
    });
    expect(roster[1]).toMatchObject({
      speakerKey: "SPEAKER_1",
      resolvedName: "Bob",
      displayLabel: "参会人 2",
    });
  });

  test("merges existing roster with nameMap", () => {
    const report = { speakerKeypoints: {} };
    const nameMap = { SPEAKER_0: "Alice" };
    const existingRoster = [{
      speakerKey: "SPEAKER_0",
      displayLabel: "参会人 1",
      possibleName: "主持人",
      aliases: ["主持人"],
      keypoints: [],
    }];
    const roster = buildSpeakerRoster(report, nameMap, {}, existingRoster);

    expect(roster).toHaveLength(1);
    expect(roster[0].resolvedName).toBe("Alice");
    expect(roster[0].possibleName).toBe("主持人");
  });

  test("adds aliases from savedSpeakerAliases", () => {
    const report = { speakerKeypoints: { SPEAKER_0: ["item"] } };
    const nameMap = { SPEAKER_0: "Alice" };
    const savedAliases = { SPEAKER_0: ["主持人", "组长"] };
    const roster = buildSpeakerRoster(report, nameMap, savedAliases);

    expect(roster[0].aliases).toContain("主持人");
    expect(roster[0].aliases).toContain("组长");
  });
});

describe("replaceNameAlias", () => {
  test("replaces alias with real name", () => {
    const result = replaceNameAlias("SPEAKER_0 said hello", "SPEAKER_0", "Alice");
    expect(result).toBe("Alice said hello");
  });

  test("handles alias as substring of real name", () => {
    const result = replaceNameAlias("佩佳 is here", "佩佳", "王佩佳");
    expect(result).toBe("王佩佳 is here");
  });

  test("does not double-replace when alias is substring", () => {
    const result = replaceNameAlias("王佩佳 and 佩佳", "佩佳", "王佩佳");
    expect(result).toBe("王佩佳 and 王佩佳");
  });

  test("returns unchanged when alias equals realName", () => {
    const result = replaceNameAlias("Alice is here", "Alice", "Alice");
    expect(result).toBe("Alice is here");
  });
});

describe("normalizeDuplicateNames", () => {
  test("removes duplicate name annotations in strings", () => {
    const result = normalizeDuplicateNames("Alice（Alice） did this", ["Alice"]);
    expect(result).toBe("Alice did this");
  });

  test("removes role prefix with name in parens", () => {
    const result = normalizeDuplicateNames("主持人（Alice）", ["Alice"]);
    expect(result).toBe("Alice");
  });

  test("recursively processes arrays", () => {
    const result = normalizeDuplicateNames(["Alice（Alice）"], ["Alice"]);
    expect(result).toEqual(["Alice"]);
  });

  test("recursively processes objects", () => {
    const result = normalizeDuplicateNames({ task: "Alice（Alice）跟进" }, ["Alice"]);
    expect(result).toEqual({ task: "Alice跟进" });
  });

  test("returns non-string/array/object values unchanged", () => {
    expect(normalizeDuplicateNames(42, ["Alice"])).toBe(42);
    expect(normalizeDuplicateNames(null, ["Alice"])).toBe(null);
  });

  test("deduplicates same name in、-separated lists", () => {
    const input = "汇报了李来、莫沙东、魏一博、拜尔、魏一博、太美、魏一博、瑞康、魏一博、魏一博、罗氏、NexusAI";
    const result = normalizeDuplicateNames(input, ["魏一博"]);
    expect(result).toBe("汇报了李来、莫沙东、魏一博、拜尔、太美、瑞康、罗氏、NexusAI");
  });

  test("deduplicates multiple names in same list", () => {
    const input = "钱凯、魏一博、Alice、钱凯、魏一博";
    const result = normalizeDuplicateNames(input, ["钱凯", "魏一博"]);
    expect(result).toBe("钱凯、魏一博、Alice");
  });

  test("handles consecutive duplicates", () => {
    const input = "魏一博、魏一博、魏一博";
    const result = normalizeDuplicateNames(input, ["魏一博"]);
    expect(result).toBe("魏一博");
  });

  test("does not deduplicate names across sentence boundaries", () => {
    const input = "魏一博负责A项目。魏一博也参与了B项目";
    const result = normalizeDuplicateNames(input, ["魏一博"]);
    expect(result).toBe("魏一博负责A项目。魏一博也参与了B项目");
  });

  test("deduplicates in nested report objects", () => {
    const report = {
      summary: "参会人有魏一博、Alice、魏一博、Bob、魏一博",
      actions: [{ owner: "魏一博" }],
    };
    const result = normalizeDuplicateNames(report, ["魏一博"]);
    expect(result.summary).toBe("参会人有魏一博、Alice、Bob");
    expect(result.actions[0].owner).toBe("魏一博");
  });
});

describe("applyGlossaryAliases", () => {
  test("replaces alias with glossary term", () => {
    const glossaryItems = [{ term: "Amazon S3", aliases: "S3,Simple Storage" }];
    const { reportStr, appliedAliases } = applyGlossaryAliases("uses S3 for storage", glossaryItems);
    expect(reportStr).toBe("uses Amazon S3 for storage");
    expect(appliedAliases).toEqual([{ from: "S3", to: "Amazon S3" }]);
  });

  test("handles alias as substring of term", () => {
    const glossaryItems = [{ term: "王佩佳", aliases: "佩佳" }];
    const { reportStr } = applyGlossaryAliases("佩佳 is here and 王佩佳 too", glossaryItems);
    expect(reportStr).toBe("王佩佳 is here and 王佩佳 too");
  });

  test("handles items with no aliases", () => {
    const glossaryItems = [{ term: "AWS" }];
    const { reportStr, appliedAliases } = applyGlossaryAliases("uses AWS", glossaryItems);
    expect(reportStr).toBe("uses AWS");
    expect(appliedAliases).toEqual([]);
  });

  test("handles array aliases format", () => {
    const glossaryItems = [{ term: "DynamoDB", aliases: ["Dynamo", "DDB"] }];
    const { reportStr } = applyGlossaryAliases("uses DDB and Dynamo", glossaryItems);
    expect(reportStr).toContain("DynamoDB");
  });
});
