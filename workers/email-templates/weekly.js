const { esc, impactBadge } = require("./base");

/* ─── Weekly meeting template ──────────────────────────── */

// Build teamKPI section
function buildTeamKPI(report) {
  if (!report.teamKPI) return "";
  const kpi = report.teamKPI;
  let html = `<tr><td style="padding:0 36px 28px;">
    <p style="margin:0 0 12px;font-size:13px;font-weight:700;color:#232F3E;text-transform:uppercase;letter-spacing:0.5px;">📊 &nbsp;团队 KPI</p>`;
  if (kpi.overview) {
    html += `<p style="margin:0 0 10px;font-size:13px;color:#555;line-height:1.6;">${esc(kpi.overview)}</p>`;
  }
  if (kpi.individuals && kpi.individuals.length) {
    const statusColor = (s) => s==="completed"?"#2e7d32":s==="at-risk"?"#c62828":"#1565c0";
    const statusLabel = (s) => s==="completed"?"已完成":s==="at-risk"?"有风险":"正常";
    html += `<table width="100%" cellpadding="0" cellspacing="0" style="border-radius:6px;overflow:hidden;border:1px solid #e8edf2;">
      <tr style="background:#232F3E;">
        <td style="padding:10px 14px;font-size:12px;font-weight:700;color:#FF9900;">成员</td>
        <td style="padding:10px 14px;font-size:12px;font-weight:700;color:#FF9900;">KPI</td>
        <td style="padding:10px 14px;font-size:12px;font-weight:700;color:#FF9900;">状态</td>
      </tr>`;
    for (const ind of kpi.individuals) {
      html += `<tr style="border-bottom:1px solid #f0f0f0;">
        <td style="padding:10px 14px;font-size:13px;font-weight:600;color:#333;">${esc(ind.name)}</td>
        <td style="padding:10px 14px;font-size:13px;color:#555;">${esc(ind.kpi)}</td>
        <td style="padding:10px 14px;"><span style="color:${statusColor(ind.status)};font-weight:600;font-size:12px;">${statusLabel(ind.status)}</span></td>
      </tr>`;
    }
    html += `</table>`;
  }
  html += `</td></tr>`;
  return html;
}

// Build announcements section
function buildAnnouncements(report) {
  if (!report.announcements || !report.announcements.length) return "";
  let html = `<tr><td style="padding:0 36px 28px;">
    <p style="margin:0 0 12px;font-size:13px;font-weight:700;color:#232F3E;text-transform:uppercase;letter-spacing:0.5px;">📢 &nbsp;公司公告</p>`;
  for (const a of report.announcements) {
    html += `<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:8px;"><tr>
      <td style="padding:10px 14px;background:#f8f9fa;border-radius:6px;border-left:3px solid #232F3E;font-size:13px;color:#333;line-height:1.6;">
        <strong>${esc(a.title)}</strong>${a.detail ? `<br><span style="color:#555;">${esc(a.detail)}</span>` : ""}${a.owner ? `<br><span style="color:#879596;font-size:12px;">发布：${esc(a.owner)}</span>` : ""}
      </td>
    </tr></table>`;
  }
  html += `</td></tr>`;
  return html;
}

// Build projectReviews section
function buildProjectReviews(report) {
  if (!report.projectReviews || !report.projectReviews.length) return "";
  let html = "";
  for (const pr of report.projectReviews) {
    html += `<tr><td style="padding:0 36px 28px;">
      <p style="margin:0 0 12px;font-size:13px;font-weight:700;color:#232F3E;text-transform:uppercase;letter-spacing:0.5px;">🗂 &nbsp;${esc(pr.project)}</p>`;
    if (pr.progress) {
      html += `<p style="margin:0 0 12px;font-size:13px;color:#555;line-height:1.6;padding:10px 14px;background:#f8f9fa;border-radius:6px;">${esc(pr.progress)}</p>`;
    }
    // highlights + lowlights
    if ((pr.highlights&&pr.highlights.length)||(pr.lowlights&&pr.lowlights.length)) {
      html += `<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:10px;">`;
      if (pr.highlights && pr.highlights.length) {
        for (const h of pr.highlights) {
          html += `<tr><td style="padding:6px 14px 6px 0;font-size:13px;color:#333;"><span style="color:#2e7d32;margin-right:6px;">▲</span><strong>${esc(h.point)}</strong>${h.detail?`<span style="color:#666;"> — ${esc(h.detail)}</span>`:""}</td></tr>`;
        }
      }
      if (pr.lowlights && pr.lowlights.length) {
        for (const l of pr.lowlights) {
          html += `<tr><td style="padding:6px 14px 6px 0;font-size:13px;color:#333;"><span style="color:#e65100;margin-right:6px;">▼</span><strong>${esc(l.point)}</strong>${l.detail?`<span style="color:#666;"> — ${esc(l.detail)}</span>`:""}</td></tr>`;
        }
      }
      html += `</table>`;
    }
    // risks
    if (pr.risks && pr.risks.length) {
      for (const r of pr.risks) {
        html += `<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:6px;"><tr>
          <td style="padding:8px 14px;background:#fff8e1;border-radius:6px;border-left:3px solid #FF9900;font-size:13px;color:#333;line-height:1.5;">
            ⚠️ <strong>${esc(r.risk)}</strong> ${impactBadge(r.impact)}${r.mitigation?`<br><span style="color:#666;font-size:12px;">${esc(r.mitigation)}</span>`:""}
          </td>
        </tr></table>`;
      }
    }
    // challenges
    if (pr.challenges && pr.challenges.length) {
      for (const c of pr.challenges) {
        html += `<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:6px;"><tr>
          <td style="padding:8px 14px;background:#fce4ec;border-radius:6px;border-left:3px solid #e53935;font-size:13px;color:#333;line-height:1.5;">
            🔴 <strong>${esc(c.challenge)}</strong>${c.detail?`<br><span style="color:#666;font-size:12px;">${esc(c.detail)}</span>`:""}
          </td>
        </tr></table>`;
      }
    }
    // followUps
    if (pr.followUps && pr.followUps.length) {
      html += `<table width="100%" cellpadding="0" cellspacing="0" style="border-radius:6px;overflow:hidden;border:1px solid #e8edf2;margin-top:8px;">
        <tr style="background:#f5f5f5;">
          <td style="padding:8px 12px;font-size:11px;font-weight:700;color:#555;">跟进事项</td>
          <td style="padding:8px 12px;font-size:11px;font-weight:700;color:#555;">负责人</td>
          <td style="padding:8px 12px;font-size:11px;font-weight:700;color:#555;">截止</td>
        </tr>`;
      for (const f of pr.followUps) {
        html += `<tr style="border-top:1px solid #f0f0f0;">
          <td style="padding:8px 12px;font-size:13px;color:#333;">${esc(f.task)}</td>
          <td style="padding:8px 12px;font-size:13px;color:#555;">${esc(f.owner||"-")}</td>
          <td style="padding:8px 12px;font-size:13px;color:#666;">${esc(f.deadline||"-")}</td>
        </tr>`;
      }
      html += `</table>`;
    }
    html += `</td></tr>`;
  }
  return html;
}

// Generate weekly meeting body
function buildWeeklyBody(report) {
  return buildTeamKPI(report)
    + buildAnnouncements(report)
    + buildProjectReviews(report);
}

module.exports = { buildWeeklyBody };
