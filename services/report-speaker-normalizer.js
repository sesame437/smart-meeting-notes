function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractPossibleName(raw) {
  const cleaned = String(raw || "")
    .replace(/[（(]\s*SPEAKER_\d+[^）)]*[）)]/g, "")
    .replace(/[（(][^）)]*角色[^）)]*[）)]/g, "")
    .trim();
  return cleaned || String(raw || "");
}

function buildAnonymousSpeakerRoster(report) {
  const participants = Array.isArray(report.participants) ? report.participants : [];
  const speakerKeypoints = report && report.speakerKeypoints ? report.speakerKeypoints : {};
  const roster = new Map();

  participants.forEach((participant, index) => {
    const raw = typeof participant === "string"
      ? participant
      : (participant && participant.name) || JSON.stringify(participant);
    const speakerKeys = raw.match(/SPEAKER_\d+/g) || [];
    speakerKeys.forEach((speakerKey) => {
      const num = Number(speakerKey.split("_")[1] || index);
      const displayLabel = `参会人 ${num + 1}`;
      const aliases = new Set([raw]);
      const possibleName = extractPossibleName(raw);
      if (possibleName) aliases.add(possibleName);
      possibleName.split(/[\/、,，]/).map((part) => part.trim()).filter(Boolean).forEach((alias) => aliases.add(alias));
      roster.set(speakerKey, {
        speakerKey,
        displayLabel,
        possibleName,
        aliases: Array.from(aliases).filter(Boolean),
        keypoints: Array.isArray(speakerKeypoints[speakerKey]) ? speakerKeypoints[speakerKey] : [],
      });
    });
  });

  Object.keys(speakerKeypoints).forEach((speakerKey) => {
    if (!/^SPEAKER_\d+$/.test(speakerKey) || roster.has(speakerKey)) return;
    const num = Number(speakerKey.split("_")[1] || 0);
    roster.set(speakerKey, {
      speakerKey,
      displayLabel: `参会人 ${num + 1}`,
      possibleName: "",
      aliases: [],
      keypoints: Array.isArray(speakerKeypoints[speakerKey]) ? speakerKeypoints[speakerKey] : [],
    });
  });

  return Array.from(roster.values()).sort((a, b) => Number(a.speakerKey.split("_")[1]) - Number(b.speakerKey.split("_")[1]));
}

function replaceAllAliases(text, aliasMap) {
  let next = text;
  const entries = Object.entries(aliasMap).sort((a, b) => b[0].length - a[0].length);
  entries.forEach(([alias, label]) => {
    if (!alias || alias === label) return;
    next = next.replace(new RegExp(escapeRegex(alias), "g"), label);
  });
  return next;
}

function cleanupAnonymousLabels(text, labels) {
  let next = text;
  labels.forEach((label) => {
    const escaped = escapeRegex(label);
    next = next.replace(new RegExp(`${escaped}[（(][^）)]*[）)]`, "g"), label);
    next = next.replace(new RegExp(`${escaped}\\s*/\\s*${escaped}`, "g"), label);
  });
  return next;
}

function walkStrings(value, transform) {
  if (typeof value === "string") return transform(value);
  if (Array.isArray(value)) return value.map((item) => walkStrings(item, transform));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, walkStrings(item, transform)]));
  }
  return value;
}

function normalizeAnonymousSpeakerReport(report) {
  const speakerRoster = buildAnonymousSpeakerRoster(report);
  if (speakerRoster.length === 0) return report;

  const aliasMap = {};
  speakerRoster.forEach((entry) => {
    aliasMap[entry.speakerKey] = entry.displayLabel;
    entry.aliases.forEach((alias) => {
      aliasMap[alias] = entry.displayLabel;
    });
  });

  const labels = speakerRoster.map((entry) => entry.displayLabel);
  const normalized = walkStrings(report, (text) => cleanupAnonymousLabels(replaceAllAliases(text, aliasMap), labels));
  normalized.speakerKeypoints = report.speakerKeypoints || {};
  normalized.speakerRoster = speakerRoster.map((entry) => ({
    speakerKey: entry.speakerKey,
    displayLabel: entry.displayLabel,
    possibleName: entry.possibleName || "",
    aliases: entry.aliases || [],
    keypoints: entry.keypoints || [],
    resolvedName: "",
  }));
  normalized.participants = speakerRoster.map((entry) => entry.displayLabel);
  return normalized;
}

module.exports = {
  buildAnonymousSpeakerRoster,
  normalizeAnonymousSpeakerReport,
};
