const { esc, priorityBadge } = require("./base");

/* ─── General/Tech meeting template ────────────────────── */

// Build keyTopics section
function buildKeyTopics(report) {
  if (!report.keyTopics || !report.keyTopics.length) return "";
  let html = `<tr><td style="padding:0 36px 28px;">
    <p style="margin:0 0 12px;font-size:13px;font-weight:700;color:#232F3E;text-transform:uppercase;letter-spacing:0.5px;">📋 &nbsp;议题讨论</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-radius:6px;overflow:hidden;border:1px solid #e8edf2;">
      <tr style="background:#232F3E;">
        <td style="padding:10px 14px;font-size:12px;font-weight:700;color:#FF9900;width:18%;">议题</td>
        <td style="padding:10px 14px;font-size:12px;font-weight:700;color:#FF9900;width:52%;">讨论要点</td>
        <td style="padding:10px 14px;font-size:12px;font-weight:700;color:#FF9900;width:30%;">结论</td>
      </tr>`;
  for (const t of report.keyTopics) {
    html += `<tr style="border-bottom:1px solid #f0f0f0;">
      <td style="padding:10px 14px;font-size:13px;color:#333;font-weight:600;width:18%;">${esc(t.topic)}</td>
      <td style="padding:10px 14px;font-size:13px;color:#555;width:52%;">${esc(t.discussion)}</td>
      <td style="padding:10px 14px;font-size:13px;color:#333;width:30%;word-break:break-word;">${esc(t.conclusion||"待定")}</td>
    </tr>`;
  }
  html += `</table></td></tr>`;
  return html;
}

// Build highlights section
function buildHighlights(report) {
  if (!report.highlights || !report.highlights.length) return "";
  if (report.projectReviews) return ""; // Weekly has highlights in projectReviews
  let html = `<tr><td style="padding:0 36px 28px;">
    <p style="margin:0 0 12px;font-size:13px;font-weight:700;color:#232F3E;text-transform:uppercase;letter-spacing:0.5px;">✨ &nbsp;亮点</p>`;
  for (const h of report.highlights) {
    html += `<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:6px;"><tr>
      <td style="padding:8px 14px;font-size:13px;color:#333;line-height:1.6;">
        <span style="color:#2e7d32;margin-right:8px;">▲</span><strong>${esc(h.point)}</strong>${h.detail?`<br><span style="color:#666;padding-left:20px;display:inline-block;">${esc(h.detail)}</span>`:""}
      </td>
    </tr></table>`;
  }
  html += `</td></tr>`;
  return html;
}

// Build lowlights section
function buildLowlights(report) {
  if (!report.lowlights || !report.lowlights.length) return "";
  if (report.projectReviews) return ""; // Weekly has lowlights in projectReviews
  let html = `<tr><td style="padding:0 36px 28px;">
    <p style="margin:0 0 12px;font-size:13px;font-weight:700;color:#232F3E;text-transform:uppercase;letter-spacing:0.5px;">⚠️ &nbsp;风险 / 问题</p>`;
  for (const l of report.lowlights) {
    html += `<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:6px;"><tr>
      <td style="padding:8px 14px;background:#fff8e1;border-radius:6px;border-left:3px solid #FF9900;font-size:13px;color:#333;line-height:1.5;">
        <strong>${esc(l.point)}</strong>${l.detail?`<br><span style="color:#666;font-size:12px;">${esc(l.detail)}</span>`:""}
      </td>
    </tr></table>`;
  }
  html += `</td></tr>`;
  return html;
}

// Build decisions section
function buildDecisions(report) {
  if (!report.decisions || !report.decisions.length) return "";
  let html = `<tr><td style="padding:0 36px 28px;">
    <p style="margin:0 0 12px;font-size:13px;font-weight:700;color:#232F3E;text-transform:uppercase;letter-spacing:0.5px;">🔑 &nbsp;关键决策</p>`;
  for (const d of report.decisions) {
    html += `<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:8px;"><tr>
      <td style="padding:10px 14px;background:#f8f9fa;border-radius:6px;border-left:3px solid #232F3E;font-size:13px;color:#333;line-height:1.6;">
        <strong>${esc(d.decision)}</strong>${d.rationale?`<br><span style="color:#666;font-size:12px;">${esc(d.rationale)}</span>`:""}${d.owner?`<span style="color:#879596;font-size:12px;"> — ${esc(d.owner)}</span>`:""}
      </td>
    </tr></table>`;
  }
  html += `</td></tr>`;
  return html;
}

// Build actions section
function buildActions(report) {
  if (!report.actions || !report.actions.length) return "";
  let html = `<tr><td style="padding:0 36px 28px;">
    <p style="margin:0 0 12px;font-size:13px;font-weight:700;color:#232F3E;text-transform:uppercase;letter-spacing:0.5px;">✅ &nbsp;行动项</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-radius:6px;overflow:hidden;border:1px solid #e8edf2;">
      <tr style="background:#232F3E;">
        <td style="padding:10px 14px;font-size:12px;font-weight:700;color:#FF9900;">负责人</td>
        <td style="padding:10px 14px;font-size:12px;font-weight:700;color:#FF9900;">任务</td>
        <td style="padding:10px 14px;font-size:12px;font-weight:700;color:#FF9900;">截止</td>
        <td style="padding:10px 14px;font-size:12px;font-weight:700;color:#FF9900;">优先级</td>
      </tr>`;
  for (const a of report.actions) {
    html += `<tr style="border-top:1px solid #f0f0f0;">
      <td style="padding:10px 14px;font-size:13px;color:#333;font-weight:600;">${esc(a.owner||"-")}</td>
      <td style="padding:10px 14px;font-size:13px;color:#333;">${esc(a.task)}</td>
      <td style="padding:10px 14px;font-size:13px;color:#666;">${esc(a.deadline||"-")}</td>
      <td style="padding:10px 14px;">${priorityBadge(a.priority)}</td>
    </tr>`;
  }
  html += `</table></td></tr>`;
  return html;
}

// Generate general/tech meeting body
function buildGeneralBody(report) {
  return buildKeyTopics(report)
    + buildHighlights(report)
    + buildLowlights(report)
    + buildDecisions(report)
    + buildActions(report);
}

module.exports = { buildGeneralBody };
