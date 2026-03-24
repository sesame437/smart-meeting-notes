"use strict";

function isIgnorableAliasFragment(value) {
  if (!value) return true;
  if (/^SPEAKER_\d+$/.test(value)) return true;
  if (/(方向|负责人|团队|开发者|角色|项目|平台|workshop|demo|SA|BD|IT|POC)/i.test(value)) return true;
  return /^[A-Z]{1,4}$/i.test(value);
}

function resolveRosterSpeakerKey(entry, index, nameMap) {
  const rawKey = entry && typeof entry.speakerKey === "string" ? entry.speakerKey.trim() : "";
  if (/^SPEAKER_\d+$/.test(rawKey)) return rawKey;
  const values = [entry && entry.displayLabel, entry && entry.possibleName,
    ...(entry && Array.isArray(entry.aliases) ? entry.aliases : [])]
    .filter(Boolean).map((v) => String(v));
  const matchedByRealName = Object.entries(nameMap).filter(([, rn]) => values.some((v) => v.includes(rn)));
  if (matchedByRealName.length === 1) return matchedByRealName[0][0];
  const explicit = values.map((v) => v.match(/SPEAKER_\d+/)).find(Boolean);
  if (explicit) return explicit[0];
  const displayMatch = values.map((v) => v.match(/参会人\s*(\d+)/)).find(Boolean);
  if (displayMatch) return `SPEAKER_${Math.max(Number(displayMatch[1]) - 1, 0)}`;
  return `SPEAKER_${index}`;
}

function splitParts(str) {
  return str.split(/[/、,，]/).map((s) => s.trim()).filter(Boolean);
}

function addAliasVariants(targetMap, realName, values = []) {
  const aliases = new Set();
  values.filter(Boolean).map((v) => String(v).trim()).filter(Boolean).forEach((value) => {
    aliases.add(value);
    const noSpk = value.replace(/SPEAKER_\d+/g, "").replace(/\s+/g, " ").trim();
    if (noSpk) aliases.add(noSpk);
    const noParen = value.replace(/[（(][^）)]*[）)]/g, "").trim();
    if (noParen) aliases.add(noParen);
    for (const m of value.matchAll(/[（(]([^）)]+)[）)]/g)) {
      splitParts(m[1] || "").forEach((p) => { if (!isIgnorableAliasFragment(p)) aliases.add(p); });
    }
    splitParts(noSpk).forEach((p) => { if (!isIgnorableAliasFragment(p)) aliases.add(p); });
  });
  aliases.forEach((a) => { if (a && a !== realName) targetMap[a] = realName; });
}

function collectSpeakerAliasMap(participants, nameMap, savedSpeakerAliases = {}, existingRoster = []) {
  const aliasMap = {};
  Object.entries(savedSpeakerAliases || {}).forEach(([spk, aliases]) => {
    const rn = nameMap[spk];
    if (rn && Array.isArray(aliases)) addAliasVariants(aliasMap, rn, aliases);
  });
  (participants || []).forEach((participant, index) => {
    const raw = typeof participant === "string" ? participant : (participant && participant.name) || JSON.stringify(participant);
    const matched = raw.match(/SPEAKER_\d+/g) || [];
    const fallback = `SPEAKER_${index}`;
    const keys = matched.length > 0 ? matched : (nameMap[fallback] ? [fallback] : []);
    keys.forEach((spk) => {
      const rn = nameMap[spk];
      if (!rn) return;
      const aliases = new Set([raw]);
      const noSpk = raw.replace(/[（(]\s*SPEAKER_\d+\s*[）)]/g, "").trim();
      if (noSpk) aliases.add(noSpk);
      const noParen = noSpk.replace(/[（(][^）)]*[）)]/g, "").trim();
      if (noParen) aliases.add(noParen);
      splitParts(noSpk).forEach((a) => aliases.add(a));
      splitParts(noParen).forEach((a) => aliases.add(a));
      addAliasVariants(aliasMap, rn, Array.from(aliases));
    });
  });
  (existingRoster || []).forEach((entry, index) => {
    if (!entry) return;
    const spk = resolveRosterSpeakerKey(entry, index, nameMap);
    const rn = nameMap[spk];
    if (!rn) return;
    addAliasVariants(aliasMap, rn, [entry.displayLabel, entry.possibleName, entry.resolvedName,
      `参会人 ${index + 1}`, ...(Array.isArray(entry.aliases) ? entry.aliases : [])]);
  });
  return aliasMap;
}

function normalizeDuplicateNames(value, names) {
  if (typeof value === "string") {
    let next = value;
    names.forEach((name) => {
      const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      next = next.replace(new RegExp(`${esc}[（(][^）)]*[）)]`, "g"), name);
      next = next.replace(new RegExp(`(?:主持人|成员[A-Z]|参会人\\s*\\d+)[（(]${esc}[）)]`, "g"), name);
      next = next.replace(new RegExp(`(?:主持人|成员[A-Z]|参会人\\s*\\d+)[（(]${esc}[^）)]*[）)]`, "g"), name);
      [`${name}（${name}）`, `${name}(${name})`, `${name}/${name}`, `${name} / ${name}`]
        .forEach((pat) => { next = next.split(pat).join(name); });
      next = next.split(`${name}（${name}/`).join(`${name}（`);
      next = next.split(`${name}(${name}/`).join(`${name}(`);
      next = next.split(`${name.charAt(0)}${name}`).join(name);

      // Deduplicate name in、-separated lists:
      // "A、魏一博、B、魏一博、C、魏一博" → "A、魏一博、B、C"
      let prev;
      do {
        prev = next;
        next = next.replace(
          new RegExp(`(${esc})((?:、(?:(?!${esc})[^、。！？\\n])+)*)、${esc}`, "g"),
          "$1$2"
        );
      } while (next !== prev);
    });
    return next;
  }
  if (Array.isArray(value)) return value.map((item) => normalizeDuplicateNames(item, names));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalizeDuplicateNames(v, names)]));
  }
  return value;
}

function replaceNameAlias(reportStr, alias, realName) {
  if (!alias || !realName || alias === realName) return reportStr;
  const aliasIndex = realName.indexOf(alias);
  if (aliasIndex === -1) return reportStr.replaceAll(alias, realName);
  const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const prefix = realName.slice(0, aliasIndex);
  const suffix = realName.slice(aliasIndex + alias.length);
  let pat = "";
  if (prefix) pat += `(?<!${esc(prefix)})`;
  pat += esc(alias);
  if (suffix) pat += `(?!${esc(suffix)})`;
  return reportStr.replace(new RegExp(pat, "g"), realName);
}

function makeRosterEntry(speakerKey, overrides = {}) {
  const num = Number(speakerKey.split("_")[1] || 0);
  return {
    speakerKey, displayLabel: `参会人 ${num + 1}`, resolvedName: "",
    possibleName: "", aliases: [], keypoints: [], ...overrides,
  };
}

function buildSpeakerRoster(report, nameMap, savedSpeakerAliases = {}, existingRoster = []) {
  const stableKP = report.speakerKeypoints || {};
  const rosterMap = new Map();
  (existingRoster || []).forEach((entry, index) => {
    if (!entry) return;
    const spk = resolveRosterSpeakerKey(entry, index, nameMap);
    rosterMap.set(spk, makeRosterEntry(spk, {
      displayLabel: entry.displayLabel || `参会人 ${Number(spk.split("_")[1] || 0) + 1}`,
      resolvedName: entry.resolvedName || nameMap[spk] || "",
      possibleName: entry.possibleName || "",
      aliases: Array.isArray(entry.aliases) ? entry.aliases.filter(Boolean) : [],
      keypoints: Array.isArray(entry.keypoints) ? entry.keypoints.filter(Boolean) : [],
    }));
  });
  Object.keys(stableKP).forEach((spk) => {
    if (!/^SPEAKER_\d+$/.test(spk)) {
      // LLM sometimes uses real names as keys — reverse-lookup SPEAKER_X from nameMap
      const matched = Object.entries(nameMap).find(([, rn]) => rn === spk);
      if (matched) {
        const speakerKey = matched[0];
        if (!rosterMap.has(speakerKey)) {
          rosterMap.set(speakerKey, makeRosterEntry(speakerKey, {
            resolvedName: spk,
            keypoints: Array.isArray(stableKP[spk]) ? stableKP[spk] : [],
          }));
        } else {
          const cur = rosterMap.get(speakerKey);
          if (!cur.keypoints || cur.keypoints.length === 0) {
            cur.keypoints = Array.isArray(stableKP[spk]) ? stableKP[spk] : cur.keypoints;
          }
        }
      }
      return;
    }
    if (!rosterMap.has(spk)) {
      rosterMap.set(spk, makeRosterEntry(spk, {
        resolvedName: nameMap[spk] || "",
        keypoints: Array.isArray(stableKP[spk]) ? stableKP[spk] : [],
      }));
      return;
    }
    const cur = rosterMap.get(spk);
    cur.keypoints = Array.isArray(stableKP[spk]) ? stableKP[spk] : cur.keypoints;
    cur.resolvedName = nameMap[spk] || cur.resolvedName;
  });
  Object.entries(savedSpeakerAliases || {}).forEach(([spk, aliases]) => {
    if (!/^SPEAKER_\d+$/.test(spk)) return;
    if (!rosterMap.has(spk)) rosterMap.set(spk, makeRosterEntry(spk, { resolvedName: nameMap[spk] || "" }));
    const cur = rosterMap.get(spk);
    const list = Array.isArray(aliases) ? aliases.filter(Boolean) : [];
    cur.aliases = Array.from(new Set([...(cur.aliases || []), ...list]));
    if (!cur.possibleName && cur.aliases.length > 0) cur.possibleName = cur.aliases[0];
    cur.resolvedName = nameMap[spk] || cur.resolvedName;
  });
  return Array.from(rosterMap.values())
    .sort((a, b) => Number(a.speakerKey.split("_")[1] || 0) - Number(b.speakerKey.split("_")[1] || 0))
    .map((entry) => {
      const aliases = Array.from(new Set((entry.aliases || []).filter(Boolean)));
      const resolved = entry.resolvedName || "";
      const candidates = [entry.speakerKey, resolved, entry.possibleName || "",
        ...aliases.filter((a) => !isIgnorableAliasFragment(a))].filter(Boolean);
      const kp = candidates.reduce((found, key) => {
        if (found.length > 0) return found;
        return Array.isArray(stableKP[key]) ? stableKP[key].filter(Boolean) : [];
      }, Array.isArray(entry.keypoints) ? entry.keypoints.filter(Boolean) : []);
      return makeRosterEntry(entry.speakerKey, {
        resolvedName: resolved, possibleName: entry.possibleName || aliases[0] || "", aliases, keypoints: kp,
      });
    });
}

function applyGlossaryAliases(reportStr, glossaryItems) {
  const appliedAliases = [];
  const aliasMap = {};
  glossaryItems.forEach((item) => {
    if (!item.aliases) return;
    const aliases = typeof item.aliases === "string"
      ? item.aliases.split(/[,，]/).map((s) => s.trim()).filter(Boolean) : item.aliases;
    aliases.forEach((a) => { if (a && a !== item.term) aliasMap[a] = item.term; });
  });
  const sorted = Object.keys(aliasMap).sort((a, b) => b.length - a.length);
  const done = new Set();
  let result = reportStr;
  sorted.forEach((alias) => {
    const term = aliasMap[alias];
    if (alias === term || done.has(alias)) return;
    const jsonAlias = JSON.stringify(alias).slice(1, -1);
    if (!result.includes(jsonAlias)) return;
    const markDone = () => Object.entries(aliasMap).forEach(([a, t]) => { if (t === term) done.add(a); });
    if (term.includes(alias)) {
      const pre = term.slice(0, term.indexOf(alias));
      const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const before = result;
      result = result.replace(new RegExp(`(?<!${esc(pre)})${esc(alias)}`, "g"), term);
      if (result !== before) { appliedAliases.push({ from: alias, to: term }); markDone(); }
    } else {
      result = result.replaceAll(alias, term);
      appliedAliases.push({ from: alias, to: term }); markDone();
    }
  });
  return { reportStr: result, appliedAliases };
}

module.exports = {
  collectSpeakerAliasMap, buildSpeakerRoster, replaceNameAlias,
  normalizeDuplicateNames, applyGlossaryAliases, isIgnorableAliasFragment, resolveRosterSpeakerKey,
};
