/**
 * ui-render.test.js
 * Unit tests for pure rendering helpers in public/js/app.js
 *
 * Since app.js runs in a browser context, we replicate / extract
 * the pure functions here and test them in Node with a minimal DOM shim.
 */

/* ──────────────────────────────────────────────
   Minimal DOM shim (no jsdom dependency needed)
   ────────────────────────────────────────────── */
class FakeElement {
  constructor() { this.textContent = ""; this.innerHTML = ""; }
  get innerHTML() { return this._innerHTML || ""; }
  set innerHTML(v) { this._innerHTML = v; }
}

global.document = {
  createElement: () => new FakeElement(),
};

/* ──────────────────────────────────────────────
   Re-implement the pure helpers from app.js
   (copied verbatim – any change there must sync here)
   ────────────────────────────────────────────── */
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  // In Node the fake element just stores textContent; return it as-is
  // (a real browser would HTML-encode it, but the logic is what we test).
  return div.textContent;
}

function formatParticipantSpeakerLabel(speakerKey) {
  const match = String(speakerKey || "").match(/^SPEAKER_(\d+)$/);
  if (!match) return "参会人";
  return `参会人 ${Number(match[1]) + 1}`;
}

function getSpeakerEntries(report, speakerMap) {
  if (Array.isArray(report.speakerRoster) && report.speakerRoster.length > 0) {
    return report.speakerRoster.map((entry, index) => ({
      speakerKey: entry.speakerKey || `SPEAKER_${index}`,
      displayLabel: entry.displayLabel || formatParticipantSpeakerLabel(entry.speakerKey || `SPEAKER_${index}`),
      possibleName: entry.possibleName || entry.resolvedName || "",
      currentName: entry.resolvedName || "",
      keypoints: Array.isArray(entry.keypoints) ? entry.keypoints : [],
      savedName: (speakerMap && speakerMap[entry.speakerKey]) || entry.resolvedName || "",
    }));
  }

  const speakerKeypoints = report.speakerKeypoints || {};
  const participantHints = new Map();
  const speakerKeys = new Set();

  (report.participants || []).forEach((participant) => {
    const raw = typeof participant === "string"
      ? participant
      : (participant && participant.name) || JSON.stringify(participant);
    const matches = raw.match(/SPEAKER_\d+/g) || [];
    matches.forEach((speakerKey) => {
      speakerKeys.add(speakerKey);
      if (!participantHints.has(speakerKey)) {
        const cleaned = raw.replace(/[（(]\s*SPEAKER_\d+\s*[）)]/g, "").trim();
        participantHints.set(speakerKey, cleaned || raw);
      }
    });
  });

  Object.keys(speakerKeypoints).forEach((speakerKey) => {
    if (/^SPEAKER_\d+$/.test(speakerKey)) speakerKeys.add(speakerKey);
  });

  Object.keys(speakerMap || {}).forEach((speakerKey) => {
    if (/^SPEAKER_\d+$/.test(speakerKey)) speakerKeys.add(speakerKey);
  });

  return Array.from(speakerKeys)
    .sort((a, b) => Number(a.split("_")[1]) - Number(b.split("_")[1]))
    .map((speakerKey) => ({
      speakerKey,
      displayLabel: formatParticipantSpeakerLabel(speakerKey),
      possibleName: participantHints.get(speakerKey) || "",
      keypoints: speakerKeypoints[speakerKey] || [],
      savedName: (speakerMap && speakerMap[speakerKey]) || "",
    }));
}

function statusBadge(status) {
  const labels = {
    pending: "Pending", created: "Created",
    transcribed: "Transcribed", transcribing: "Transcribing",
    reported: "Reported", processing: "Processing",
    completed: "Completed", failed: "Failed"
  };
  const label = labels[status] || status;
  return `<span class="badge badge-${status}">${label}</span>`;
}

function meetingCard(m) {
  const title  = escapeHtml(m.title || m.meetingId);
  const time   = m.createdAt ? new Date(m.createdAt).toLocaleString("zh-CN") : "-";
  const status = m.status || "pending";
  const id     = m.meetingId;

  return `
  <div class="meeting-card-item">
    <div class="item-title">
      <a href="meeting.html?id=${encodeURIComponent(id)}">${title}</a>
    </div>
    <div class="item-time">${time}</div>
    <div>${statusBadge(status)}</div>
    <div class="item-actions">
      <a href="meeting.html?id=${encodeURIComponent(id)}" class="btn btn-outline btn-sm"><i class="fa fa-eye"></i> View</a>
      ${status === "completed" ? `<button class="btn btn-success btn-sm" data-action="download-pdf" data-id="${id}"><i class="fa fa-download"></i> PDF</button>` : ""}
      <button class="btn btn-danger btn-sm" data-action="delete-meeting" data-id="${id}"><i class="fa fa-trash"></i></button>
    </div>
  </div>`;
}

// ── renderMeetingDetail sub-helpers (extracted from the inline render) ──

function priorityBadge(priority) {
  const prio = (priority || "").toLowerCase();
  return `<span class="priority-badge priority-${prio}">${escapeHtml(priority || "-")}</span>`;
}

function renderDetailBlocks(m) {
  const report       = m.content || {};
  const highlights   = report.highlights   || [];
  const lowlights    = report.lowlights    || [];
  const actions      = report.actions      || [];
  const decisions    = report.decisions    || [];
  const risks        = report.risks        || report.issues || [];
  const participants = report.participants || [];
  const topics       = report.topics       || [];
  const summary      = report.summary      || "No summary available yet.";
  const duration     = report.duration     || m.duration || "-";

  // weekly-specific fields
  const teamKPI        = report.teamKPI        || [];
  const announcements  = report.announcements  || [];
  const projectReviews = report.projectReviews || [];

  return {
    highlights, lowlights, actions, decisions, risks,
    participants, topics, summary, duration,
    teamKPI, announcements, projectReviews,
  };
}

/* ════════════════════════════════════════════════════
   TEST SUITES
   ════════════════════════════════════════════════════ */

describe("statusBadge()", () => {
  test("completed → badge-completed with label 'Completed'", () => {
    const html = statusBadge("completed");
    expect(html).toContain("badge-completed");
    expect(html).toContain("Completed");
  });

  test("processing → badge-processing with label 'Processing'", () => {
    const html = statusBadge("processing");
    expect(html).toContain("badge-processing");
    expect(html).toContain("Processing");
  });

  test("failed → badge-failed with label 'Failed'", () => {
    const html = statusBadge("failed");
    expect(html).toContain("badge-failed");
    expect(html).toContain("Failed");
  });

  test("unknown status → badge class uses raw value as fallback", () => {
    const html = statusBadge("custom-status");
    expect(html).toContain("badge-custom-status");
    expect(html).toContain("custom-status");
  });
});

describe("priorityBadge()", () => {
  test("high → priority-high class + 'High' label", () => {
    const html = priorityBadge("High");
    expect(html).toContain("priority-high");
    expect(html).toContain("High");
  });

  test("medium → priority-medium class", () => {
    const html = priorityBadge("Medium");
    expect(html).toContain("priority-medium");
  });

  test("low → priority-low class", () => {
    const html = priorityBadge("Low");
    expect(html).toContain("priority-low");
  });

  test("undefined priority → renders '-' safely (no crash)", () => {
    expect(() => priorityBadge(undefined)).not.toThrow();
    const html = priorityBadge(undefined);
    expect(html).toContain("-");
  });
});

describe("meetingCard() – card rendering & null safety", () => {
  const BASE = {
    meetingId: "mtg-001",
    title: "Q1 Planning",
    createdAt: "2026-01-15T09:00:00Z",
    status: "completed",
  };

  test("renders title and link correctly", () => {
    const html = meetingCard(BASE);
    expect(html).toContain("Q1 Planning");
    expect(html).toContain("meeting.html?id=mtg-001");
  });

  test("shows PDF button only for completed meetings", () => {
    expect(meetingCard(BASE)).toContain('data-action="download-pdf"');
    expect(meetingCard({ ...BASE, status: "processing" })).not.toContain('data-action="download-pdf"');
  });

  test("falls back to meetingId when title is missing", () => {
    const m = { meetingId: "mtg-002", status: "pending" };
    const html = meetingCard(m);
    expect(html).toContain("mtg-002");
  });

  test("createdAt missing → shows '-'", () => {
    const m = { meetingId: "mtg-003", title: "No Date", status: "pending" };
    const html = meetingCard(m);
    expect(html).toContain('class="item-time">-');
  });

  test("status defaults to 'pending' when missing", () => {
    const m = { meetingId: "mtg-004", title: "No Status" };
    const html = meetingCard(m);
    expect(html).toContain("badge-pending");
  });
});

describe("renderDetailBlocks() – detail page data extraction & null safety", () => {
  test("empty content object → all arrays are empty, summary has fallback", () => {
    const blocks = renderDetailBlocks({ meetingId: "x" });
    expect(blocks.actions).toEqual([]);
    expect(blocks.decisions).toEqual([]);
    expect(blocks.risks).toEqual([]);
    expect(blocks.participants).toEqual([]);
    expect(blocks.topics).toEqual([]);
    expect(blocks.highlights).toEqual([]);
    expect(blocks.lowlights).toEqual([]);
    expect(blocks.summary).toBe("No summary available yet.");
    expect(blocks.duration).toBe("-");
  });

  test("m.content undefined (report field missing) → does not crash", () => {
    expect(() => renderDetailBlocks({})).not.toThrow();
    expect(() => renderDetailBlocks({ meetingId: "x", content: null })).not.toThrow();
  });

  test("content.null → falls back gracefully without crash", () => {
    const blocks = renderDetailBlocks({ content: null });
    expect(blocks.actions).toEqual([]);
  });

  test("duration falls back to m.duration when not in report", () => {
    const blocks = renderDetailBlocks({ duration: "45m", content: {} });
    expect(blocks.duration).toBe("45m");
  });
});

describe("weekly-specific fields (teamKPI / announcements / projectReviews)", () => {
  test("weekly fields default to empty arrays when missing", () => {
    const blocks = renderDetailBlocks({ content: {} });
    expect(blocks.teamKPI).toEqual([]);
    expect(blocks.announcements).toEqual([]);
    expect(blocks.projectReviews).toEqual([]);
  });

  test("weekly fields are extracted when present", () => {
    const blocks = renderDetailBlocks({
      content: {
        teamKPI: [{ metric: "OKR", value: "80%" }],
        announcements: ["Announcement A"],
        projectReviews: [{ project: "P1", status: "on-track" }],
      }
    });
    expect(blocks.teamKPI).toHaveLength(1);
    expect(blocks.announcements).toEqual(["Announcement A"]);
    expect(blocks.projectReviews[0].project).toBe("P1");
  });
});

describe("participants display count", () => {
  test("participants.length used as count", () => {
    const m = {
      meetingId: "x",
      content: { participants: ["Alice", "Bob", "Charlie"] }
    };
    const blocks = renderDetailBlocks(m);
    expect(blocks.participants.length).toBe(3);
  });

  test("zero participants → length is 0 (detail shows '-')", () => {
    const blocks = renderDetailBlocks({ content: { participants: [] } });
    expect(blocks.participants.length).toBe(0);
  });
});

describe("formatParticipantSpeakerLabel()", () => {
  test("converts SPEAKER_0 to 参会人 1", () => {
    expect(formatParticipantSpeakerLabel("SPEAKER_0")).toBe("参会人 1");
  });

  test("falls back to generic label for unknown keys", () => {
    expect(formatParticipantSpeakerLabel("主持人")).toBe("参会人");
  });
});

describe("getSpeakerEntries()", () => {
  test("prefers stable speakerRoster when present", () => {
    const entries = getSpeakerEntries({
      speakerRoster: [
        {
          speakerKey: "SPEAKER_0",
          displayLabel: "参会人 1",
          possibleName: "主持人",
          resolvedName: "Alice",
          keypoints: ["开场"],
        },
      ],
    }, { SPEAKER_0: "Alice" });

    expect(entries).toEqual([
      {
        speakerKey: "SPEAKER_0",
        displayLabel: "参会人 1",
        possibleName: "主持人",
        currentName: "Alice",
        keypoints: ["开场"],
        savedName: "Alice",
      },
    ]);
  });

  test("builds stable participant rows from speakerKeypoints and participants", () => {
    const entries = getSpeakerEntries({
      participants: ["主持人（SPEAKER_0）", "成员A/李龙（SPEAKER_1）"],
      speakerKeypoints: {
        SPEAKER_0: ["开场并分配任务"],
        SPEAKER_1: ["汇报客户项目进展"],
      },
    }, { SPEAKER_1: "宋孜攀" });

    expect(entries).toEqual([
      {
        speakerKey: "SPEAKER_0",
        displayLabel: "参会人 1",
        possibleName: "主持人",
        keypoints: ["开场并分配任务"],
        savedName: "",
      },
      {
        speakerKey: "SPEAKER_1",
        displayLabel: "参会人 2",
        possibleName: "成员A/李龙",
        keypoints: ["汇报客户项目进展"],
        savedName: "宋孜攀",
      },
    ]);
  });
});
