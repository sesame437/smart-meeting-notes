const { esc } = require("./base");

/* ─── Interview meeting template ─────────────────────────── */

function buildCandidateInfo(report) {
  const ci = report.candidateInfo;
  if (!ci) return "";
  const fields = [
    ci.name && `<strong>姓名：</strong>${esc(ci.name)}`,
    ci.position && `<strong>应聘职位：</strong>${esc(ci.position)}`,
    ci.level && `<strong>级别：</strong>${esc(ci.level)}`,
    ci.interviewer && `<strong>面试官：</strong>${esc(ci.interviewer)}`,
    ci.interviewType && `<strong>面试形式：</strong>${esc(ci.interviewType)}`,
  ].filter(Boolean);
  if (!fields.length) return "";
  return `<tr><td style="padding:0 36px 28px;">
    <p style="margin:0 0 12px;font-size:13px;font-weight:700;color:#232F3E;text-transform:uppercase;letter-spacing:0.5px;">👤 &nbsp;候选人信息</p>
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="padding:12px 16px;background:#f8f9fa;border-radius:6px;font-size:13px;color:#333;line-height:2;">
        ${fields.join("<br>")}
      </td>
    </tr></table>
  </td></tr>`;
}

function buildRecommendation(report) {
  const rec = report.recommendation;
  if (!rec) return "";
  const colors = {
    hire: "#2e7d32",
    "inclined-hire": "#558b2f",
    "inclined-no-hire": "#e65100",
    "no-hire": "#c62828",
  };
  const labels = {
    hire: "建议录用",
    "inclined-hire": "倾向录用",
    "inclined-no-hire": "倾向不录用",
    "no-hire": "不建议录用",
  };
  const color = colors[rec.decision] || "#666";
  const label = labels[rec.decision] || rec.decision;
  let html = `<tr><td style="padding:0 36px 28px;">
    <p style="margin:0 0 12px;font-size:13px;font-weight:700;color:#232F3E;text-transform:uppercase;letter-spacing:0.5px;">⚖️ &nbsp;录用建议</p>
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="padding:14px 16px;border-left:4px solid ${color};background:#f8f9fa;border-radius:0 6px 6px 0;font-size:13px;color:#333;line-height:1.6;">
        <span style="font-size:16px;font-weight:700;color:${color};">${esc(label)}</span>`;
  if (rec.reasoning) html += `<br><span style="color:#555;">${esc(rec.reasoning)}</span>`;
  const meta = [
    rec.suggestedLevel && `建议级别: ${esc(rec.suggestedLevel)}`,
    rec.suggestedRole && `建议角色: ${esc(rec.suggestedRole)}`,
  ].filter(Boolean);
  if (meta.length) {
    html += `<br><span style="color:#879596;font-size:12px;">${meta.join(" · ")}</span>`;
  }
  html += `</td></tr></table></td></tr>`;
  return html;
}

function buildLpAssessment(report) {
  if (!report.lpAssessment || !report.lpAssessment.length) return "";
  const rColors = { strong: "#2e7d32", satisfactory: "#1565c0", weak: "#c62828", "not-assessed": "#999" };
  const rLabels = { strong: "优秀", satisfactory: "合格", weak: "较弱", "not-assessed": "未考察" };
  let html = `<tr><td style="padding:0 36px 28px;">
    <p style="margin:0 0 12px;font-size:13px;font-weight:700;color:#232F3E;text-transform:uppercase;letter-spacing:0.5px;">⭐ &nbsp;Leadership Principles 评估</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-radius:6px;overflow:hidden;border:1px solid #e8edf2;">
      <tr style="background:#232F3E;">
        <td style="padding:10px 14px;font-size:12px;font-weight:700;color:#FF9900;width:25%;">LP</td>
        <td style="padding:10px 14px;font-size:12px;font-weight:700;color:#FF9900;width:12%;">评分</td>
        <td style="padding:10px 14px;font-size:12px;font-weight:700;color:#FF9900;">行为证据</td>
      </tr>`;
  for (const lp of report.lpAssessment) {
    const rc = rColors[lp.rating] || "#666";
    const rl = rLabels[lp.rating] || lp.rating;
    html += `<tr style="border-top:1px solid #f0f0f0;">
      <td style="padding:10px 14px;font-size:13px;color:#333;font-weight:600;">${esc(lp.principle)}</td>
      <td style="padding:10px 14px;"><span style="color:${rc};font-weight:600;font-size:12px;">${esc(rl)}</span></td>
      <td style="padding:10px 14px;font-size:13px;color:#555;">${esc(lp.evidence || "-")}</td>
    </tr>`;
  }
  html += `</table></td></tr>`;
  return html;
}

function buildQuestions(report) {
  if (!report.questions || !report.questions.length) return "";
  let html = `<tr><td style="padding:0 36px 28px;">
    <p style="margin:0 0 12px;font-size:13px;font-weight:700;color:#232F3E;text-transform:uppercase;letter-spacing:0.5px;">💬 &nbsp;面试问答</p>`;
  for (const q of report.questions) {
    html += `<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:10px;"><tr>
      <td style="padding:12px 16px;background:#f8f9fa;border-radius:6px;border-left:3px solid #232F3E;font-size:13px;color:#333;line-height:1.6;">
        <strong>Q: ${esc(q.question)}</strong>
        ${q.context ? `<br><span style="color:#879596;font-size:12px;">考察: ${esc(q.context)}</span>` : ""}
        ${q.answer ? `<br><span style="color:#555;">A: ${esc(q.answer)}</span>` : ""}
        ${q.assessment ? `<br><span style="color:#1565c0;font-size:12px;">评价: ${esc(q.assessment)}</span>` : ""}
      </td>
    </tr></table>`;
  }
  html += `</td></tr>`;
  return html;
}

function buildStrengthsImprovements(report) {
  let html = "";
  if (report.strengths && report.strengths.length) {
    html += `<tr><td style="padding:0 36px 28px;">
      <p style="margin:0 0 12px;font-size:13px;font-weight:700;color:#232F3E;text-transform:uppercase;letter-spacing:0.5px;">👍 &nbsp;候选人优势</p>`;
    for (const s of report.strengths) {
      html += `<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:6px;"><tr>
        <td style="padding:8px 14px;border-left:3px solid #2e7d32;font-size:13px;color:#333;line-height:1.5;">
          <strong>${esc(s.point)}</strong>${s.detail ? `<br><span style="color:#666;font-size:12px;">${esc(s.detail)}</span>` : ""}
        </td>
      </tr></table>`;
    }
    html += `</td></tr>`;
  }
  if (report.improvements && report.improvements.length) {
    html += `<tr><td style="padding:0 36px 28px;">
      <p style="margin:0 0 12px;font-size:13px;font-weight:700;color:#232F3E;text-transform:uppercase;letter-spacing:0.5px;">📈 &nbsp;待改进项</p>`;
    for (const im of report.improvements) {
      html += `<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:6px;"><tr>
        <td style="padding:8px 14px;border-left:3px solid #e65100;font-size:13px;color:#333;line-height:1.5;">
          <strong>${esc(im.point)}</strong>${im.detail ? `<br><span style="color:#666;font-size:12px;">${esc(im.detail)}</span>` : ""}
        </td>
      </tr></table>`;
    }
    html += `</td></tr>`;
  }
  return html;
}

function buildInterviewBody(report) {
  return buildCandidateInfo(report)
    + buildRecommendation(report)
    + buildLpAssessment(report)
    + buildQuestions(report)
    + buildStrengthsImprovements(report);
}

module.exports = { buildInterviewBody };
