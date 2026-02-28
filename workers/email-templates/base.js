/* ─── Shared helpers and HTML wrappers ─────────────────── */

// HTML escape
function esc(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Date formatter
function fmtDate(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  return isNaN(d) ? iso : d.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
}

// Priority badge helper
function priorityBadge(p) {
  const m = { high: ["#fff3e0","#e65100","高"], medium: ["#e8f5e9","#2e7d32","中"], low: ["#e3f2fd","#1565c0","低"] };
  const [bg, color, label] = m[(p||"medium").toLowerCase()] || m.medium;
  return `<span style="background:${bg};color:${color};font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px;">${label}</span>`;
}

// Impact badge for risks
function impactBadge(impact) {
  if (!impact) return "";
  const i = impact.toLowerCase();
  if (i === "high") return `<span style="background:#ffebee;color:#c62828;font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px;">高</span>`;
  if (i === "medium") return `<span style="background:#fff8e1;color:#f57f17;font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px;">中</span>`;
  return `<span style="background:#e8f5e9;color:#2e7d32;font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px;">低</span>`;
}

/* ─── HTML sections ─────────────────────────────────────── */

// Build summary section
function buildSummary(report) {
  if (!report.summary) return "";
  return `<tr><td style="padding:0 36px 28px;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="border-left:4px solid #FF9900;padding-left:14px;">
        <p style="margin:0 0 4px;font-size:11px;font-weight:700;color:#FF9900;text-transform:uppercase;letter-spacing:1px;">会议摘要</p>
        <p style="margin:0;font-size:15px;color:#333;line-height:1.8;">${esc(report.summary)}</p>
      </td>
    </tr></table>
  </td></tr>`;
}

// Build participants footer
function buildParticipantsFooter(participants, duration) {
  if (!participants || !participants.length) return "";
  return `<tr><td style="padding:0 36px 28px;">
    <p style="margin:0 0 6px;font-size:11px;font-weight:700;color:#879596;text-transform:uppercase;letter-spacing:0.5px;">参会人员（${participants.length}人）</p>
    <p style="margin:0;font-size:13px;color:#666;">${participants.map(esc).join(" · ")}</p>
    ${duration ? `<p style="margin:4px 0 0;font-size:12px;color:#879596;">会议时长：${esc(duration)}</p>` : ""}
  </td></tr>`;
}

// Build complete HTML wrapper
function buildHtmlWrapper(name, date, participants, duration, bodyContent) {
  const participantCount = (participants && participants.length) || 0;
  return `<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <!--[if mso]><xml><o:OfficeDocumentSettings><o:AllowPNG/><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->
</head>
<body style="margin:0;padding:0;background:#f0f2f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f2f5;padding:24px 0;">
<tr><td align="center" style="padding:0 12px;">
<!--[if mso]><table width="700" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:800px;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.10);">

<!-- Header -->
<tr><td style="background:#232F3E;padding:20px 32px;">
  <table width="100%" cellpadding="0" cellspacing="0"><tr>
    <td style="vertical-align:middle;">
      <span style="color:#FF9900;font-size:20px;font-weight:700;letter-spacing:1px;">▲ Meeting Minutes</span>
    </td>
    <td align="right" style="vertical-align:middle;">
      <span style="background:#FF9900;color:#232F3E;font-size:12px;font-weight:700;padding:5px 14px;border-radius:14px;white-space:nowrap;">已完成</span>
    </td>
  </tr></table>
</td></tr>

<!-- Meta -->
<tr><td style="background:#2d3d50;padding:16px 32px;">
  <table width="100%" cellpadding="0" cellspacing="0"><tr>
    <td style="color:#ffffff;font-size:17px;font-weight:700;line-height:1.4;">${esc(name)}</td>
    <td align="right" style="color:#8fa8be;font-size:13px;white-space:nowrap;padding-left:16px;vertical-align:middle;">${esc(date)}${duration ? ` &nbsp;|&nbsp; ${esc(duration)}` : ""}${participantCount ? ` &nbsp;|&nbsp; ${participantCount}人` : ""}</td>
  </tr></table>
</td></tr>

<!-- Spacer -->
<tr><td style="height:28px;"></td></tr>

${bodyContent}

<!-- Footer -->
<tr><td style="background:#f8f9fa;padding:16px 32px;border-top:1px solid #e8edf2;">
  <p style="margin:0;font-size:11px;color:#879596;text-align:center;">
    ⚠️ 本纪要由 AI 自动生成，内容仅供参考，请以实际会议内容为准。
  </p>
</td></tr>

</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body></html>`;
}

module.exports = {
  esc,
  fmtDate,
  priorityBadge,
  impactBadge,
  buildSummary,
  buildParticipantsFooter,
  buildHtmlWrapper,
};
