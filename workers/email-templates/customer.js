const { esc, priorityBadge } = require("./base");

/* ─── Customer meeting template ────────────────────────── */

// Build customerInfo + awsAttendees section
function buildCustomerInfo(report) {
  if (!report.customerInfo && (!report.awsAttendees || !report.awsAttendees.length)) return "";
  const ci = report.customerInfo || {};
  const awsAtt = report.awsAttendees || [];
  return `<tr><td style="padding:0 36px 28px;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="width:50%;vertical-align:top;padding-right:12px;">
        <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#232F3E;text-transform:uppercase;letter-spacing:0.5px;">🏢 &nbsp;客户信息</p>
        ${ci.company ? `<p style="margin:0 0 6px;font-size:14px;font-weight:600;color:#333;">${esc(ci.company)}</p>` : ""}
        ${ci.attendees && ci.attendees.length ? ci.attendees.map(a => `<p style="margin:0 0 2px;font-size:13px;color:#555;">· ${esc(a)}</p>`).join("") : `<p style="margin:0;font-size:13px;color:#879596;">未提及</p>`}
      </td>
      <td style="width:50%;vertical-align:top;padding-left:12px;">
        <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#232F3E;text-transform:uppercase;letter-spacing:0.5px;">☁️ &nbsp;AWS 出席人</p>
        ${awsAtt.length ? awsAtt.map(a => `<p style="margin:0 0 2px;font-size:13px;color:#555;">· ${esc(a)}</p>`).join("") : `<p style="margin:0;font-size:13px;color:#879596;">未提及</p>`}
      </td>
    </tr></table>
  </td></tr>`;
}

// Build customerNeeds section
function buildCustomerNeeds(report) {
  if (!report.customerNeeds || !report.customerNeeds.length) return "";
  let html = `<tr><td style="padding:0 36px 28px;">
    <p style="margin:0 0 12px;font-size:13px;font-weight:700;color:#232F3E;text-transform:uppercase;letter-spacing:0.5px;">🎯 &nbsp;客户需求</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-radius:6px;overflow:hidden;border:1px solid #e8edf2;">
      <tr style="background:#232F3E;">
        <td style="padding:10px 14px;font-size:12px;font-weight:700;color:#FF9900;">需求</td>
        <td style="padding:10px 14px;font-size:12px;font-weight:700;color:#FF9900;">优先级</td>
        <td style="padding:10px 14px;font-size:12px;font-weight:700;color:#FF9900;">背景</td>
      </tr>`;
  for (const n of report.customerNeeds) {
    html += `<tr style="border-bottom:1px solid #f0f0f0;">
      <td style="padding:10px 14px;font-size:13px;color:#333;font-weight:600;">${esc(n.need)}</td>
      <td style="padding:10px 14px;">${priorityBadge(n.priority)}</td>
      <td style="padding:10px 14px;font-size:13px;color:#555;">${esc(n.background||"-")}</td>
    </tr>`;
  }
  html += `</table></td></tr>`;
  return html;
}

// Build painPoints section
function buildPainPoints(report) {
  if (!report.painPoints || !report.painPoints.length) return "";
  let html = `<tr><td style="padding:0 36px 28px;">
    <p style="margin:0 0 12px;font-size:13px;font-weight:700;color:#232F3E;text-transform:uppercase;letter-spacing:0.5px;">⚡ &nbsp;客户痛点</p>`;
  for (const p of report.painPoints) {
    html += `<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:6px;"><tr>
      <td style="padding:8px 14px;background:#fff8e1;border-radius:6px;border-left:3px solid #FF9900;font-size:13px;color:#333;line-height:1.5;">
        <strong>${esc(p.point)}</strong>${p.detail?`<br><span style="color:#666;font-size:12px;">${esc(p.detail)}</span>`:""}
      </td>
    </tr></table>`;
  }
  html += `</td></tr>`;
  return html;
}

// Build solutionsDiscussed section
function buildSolutionsDiscussed(report) {
  if (!report.solutionsDiscussed || !report.solutionsDiscussed.length) return "";
  let html = `<tr><td style="padding:0 36px 28px;">
    <p style="margin:0 0 12px;font-size:13px;font-weight:700;color:#232F3E;text-transform:uppercase;letter-spacing:0.5px;">💡 &nbsp;讨论方案</p>`;
  for (const s of report.solutionsDiscussed) {
    html += `<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:8px;"><tr>
      <td style="padding:10px 14px;background:#f8f9fa;border-radius:6px;border-left:3px solid #232F3E;font-size:13px;color:#333;line-height:1.6;">
        <strong>${esc(s.solution)}</strong>
        ${s.awsServices && s.awsServices.length ? `<br>${s.awsServices.map(svc => `<span style="display:inline-block;background:#232F3E;color:#FF9900;font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;margin-right:4px;margin-top:4px;">${esc(svc)}</span>`).join("")}` : ""}
        ${s.customerFeedback ? `<br><span style="color:#555;font-size:12px;font-style:italic;">客户反馈：${esc(s.customerFeedback)}</span>` : ""}
      </td>
    </tr></table>`;
  }
  html += `</td></tr>`;
  return html;
}

// Build commitments section
function buildCommitments(report) {
  if (!report.commitments || !report.commitments.length) return "";
  let html = `<tr><td style="padding:0 36px 28px;">
    <p style="margin:0 0 12px;font-size:13px;font-weight:700;color:#232F3E;text-transform:uppercase;letter-spacing:0.5px;">🤝 &nbsp;承诺事项</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-radius:6px;overflow:hidden;border:1px solid #e8edf2;">
      <tr style="background:#232F3E;">
        <td style="padding:10px 14px;font-size:12px;font-weight:700;color:#FF9900;">方</td>
        <td style="padding:10px 14px;font-size:12px;font-weight:700;color:#FF9900;">承诺内容</td>
        <td style="padding:10px 14px;font-size:12px;font-weight:700;color:#FF9900;">负责人</td>
        <td style="padding:10px 14px;font-size:12px;font-weight:700;color:#FF9900;">截止</td>
      </tr>`;
  for (const c of report.commitments) {
    const party = (c.party || "").toLowerCase();
    const borderColor = party.includes("aws") ? "#FF9900" : "#1565c0";
    html += `<tr style="border-bottom:1px solid #f0f0f0;border-left:4px solid ${borderColor};">
      <td style="padding:10px 14px;font-size:13px;color:#333;font-weight:600;">${esc(c.party||"-")}</td>
      <td style="padding:10px 14px;font-size:13px;color:#333;">${esc(c.commitment)}</td>
      <td style="padding:10px 14px;font-size:13px;color:#555;">${esc(c.owner||"-")}</td>
      <td style="padding:10px 14px;font-size:13px;color:#666;">${esc(c.deadline||"-")}</td>
    </tr>`;
  }
  html += `</table></td></tr>`;
  return html;
}

// Build nextSteps section
function buildNextSteps(report) {
  if (!report.nextSteps || !report.nextSteps.length) return "";
  let html = `<tr><td style="padding:0 36px 28px;">
    <p style="margin:0 0 12px;font-size:13px;font-weight:700;color:#232F3E;text-transform:uppercase;letter-spacing:0.5px;">➡️ &nbsp;下一步行动</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-radius:6px;overflow:hidden;border:1px solid #e8edf2;">
      <tr style="background:#232F3E;">
        <td style="padding:10px 14px;font-size:12px;font-weight:700;color:#FF9900;">任务</td>
        <td style="padding:10px 14px;font-size:12px;font-weight:700;color:#FF9900;">负责人</td>
        <td style="padding:10px 14px;font-size:12px;font-weight:700;color:#FF9900;">截止</td>
        <td style="padding:10px 14px;font-size:12px;font-weight:700;color:#FF9900;">优先级</td>
      </tr>`;
  for (const ns of report.nextSteps) {
    html += `<tr style="border-top:1px solid #f0f0f0;">
      <td style="padding:10px 14px;font-size:13px;color:#333;">${esc(ns.task)}</td>
      <td style="padding:10px 14px;font-size:13px;color:#333;font-weight:600;">${esc(ns.owner||"-")}</td>
      <td style="padding:10px 14px;font-size:13px;color:#666;">${esc(ns.deadline||"-")}</td>
      <td style="padding:10px 14px;">${priorityBadge(ns.priority)}</td>
    </tr>`;
  }
  html += `</table></td></tr>`;
  return html;
}

// Generate customer meeting body
function buildCustomerBody(report) {
  return buildCustomerInfo(report)
    + buildCustomerNeeds(report)
    + buildPainPoints(report)
    + buildSolutionsDiscussed(report)
    + buildCommitments(report)
    + buildNextSteps(report);
}

module.exports = { buildCustomerBody };
