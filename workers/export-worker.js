require("dotenv").config();
const { receiveMessages, deleteMessage } = require("../services/sqs");
const { getFile } = require("../services/s3");
const { ses } = require("../services/ses");
const { docClient } = require("../db/dynamodb");
const { UpdateCommand, GetCommand } = require("@aws-sdk/lib-dynamodb");
const { SendEmailCommand } = require("@aws-sdk/client-ses");

const QUEUE_URL = process.env.SQS_EXPORT_QUEUE;
const TABLE = process.env.DYNAMODB_TABLE;
const POLL_INTERVAL = 5000;

/* ─── helpers ─────────────────────────────────────────── */

async function streamToString(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

function fmtDate(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  return isNaN(d) ? iso : d.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function nowISO() {
  return new Date().toISOString();
}

function nowCN() {
  return new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
}

/* ─── HTML email body (AWS Cloudscape style) ──────────── */

function buildHtmlBody(report, meetingName) {
  const esc = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const name = meetingName || report.meetingType || "会议";
  const date = report.date || fmtDate(nowISO());
  const participants = report.participants || [];
  const duration = report.duration || "";

  // Priority badge helper
  const priorityBadge = (p) => {
    const m = { high: ["#fff3e0","#e65100","高"], medium: ["#e8f5e9","#2e7d32","中"], low: ["#e3f2fd","#1565c0","低"] };
    const [bg, color, label] = m[(p||"medium").toLowerCase()] || m.medium;
    return `<span style="background:${bg};color:${color};font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px;">${label}</span>`;
  };

  // Impact badge for risks
  const impactBadge = (impact) => {
    if (!impact) return "";
    const i = impact.toLowerCase();
    if (i === "high") return `<span style="background:#ffebee;color:#c62828;font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px;">高</span>`;
    if (i === "medium") return `<span style="background:#fff8e1;color:#f57f17;font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px;">中</span>`;
    return `<span style="background:#e8f5e9;color:#2e7d32;font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px;">低</span>`;
  };

  let body = "";

  // Summary
  if (report.summary) {
    body += `<tr><td style="padding:0 32px 24px;">
      <table width="100%" cellpadding="0" cellspacing="0"><tr>
        <td style="border-left:4px solid #FF9900;padding-left:14px;">
          <p style="margin:0 0 4px;font-size:11px;font-weight:700;color:#FF9900;text-transform:uppercase;letter-spacing:1px;">会议摘要</p>
          <p style="margin:0;font-size:14px;color:#333;line-height:1.7;">${esc(report.summary)}</p>
        </td>
      </tr></table>
    </td></tr>`;
  }

  // keyTopics (general/tech)
  if (report.keyTopics && report.keyTopics.length) {
    body += `<tr><td style="padding:0 32px 24px;">
      <p style="margin:0 0 12px;font-size:13px;font-weight:700;color:#232F3E;text-transform:uppercase;letter-spacing:0.5px;">📋 &nbsp;议题讨论</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-radius:6px;overflow:hidden;border:1px solid #e8edf2;">
        <tr style="background:#232F3E;">
          <td style="padding:10px 14px;font-size:12px;font-weight:700;color:#FF9900;width:20%;">议题</td>
          <td style="padding:10px 14px;font-size:12px;font-weight:700;color:#FF9900;width:40%;">讨论要点</td>
          <td style="padding:10px 14px;font-size:12px;font-weight:700;color:#FF9900;width:40%;">结论</td>
        </tr>`;
    for (const t of report.keyTopics) {
      body += `<tr style="border-bottom:1px solid #f0f0f0;">
        <td style="padding:10px 14px;font-size:13px;color:#333;font-weight:600;width:20%;">${esc(t.topic)}</td>
        <td style="padding:10px 14px;font-size:13px;color:#555;width:40%;">${esc(t.discussion)}</td>
        <td style="padding:10px 14px;font-size:13px;color:#333;width:40%;word-break:break-word;">${esc(t.conclusion||"待定")}</td>
      </tr>`;
    }
    body += `</table></td></tr>`;
  }

  // weekly: teamKPI
  if (report.teamKPI) {
    const kpi = report.teamKPI;
    body += `<tr><td style="padding:0 32px 24px;">
      <p style="margin:0 0 12px;font-size:13px;font-weight:700;color:#232F3E;text-transform:uppercase;letter-spacing:0.5px;">📊 &nbsp;团队 KPI</p>`;
    if (kpi.overview) {
      body += `<p style="margin:0 0 10px;font-size:13px;color:#555;line-height:1.6;">${esc(kpi.overview)}</p>`;
    }
    if (kpi.individuals && kpi.individuals.length) {
      const statusColor = (s) => s==="completed"?"#2e7d32":s==="at-risk"?"#c62828":"#1565c0";
      const statusLabel = (s) => s==="completed"?"已完成":s==="at-risk"?"有风险":"正常";
      body += `<table width="100%" cellpadding="0" cellspacing="0" style="border-radius:6px;overflow:hidden;border:1px solid #e8edf2;">
        <tr style="background:#232F3E;">
          <td style="padding:10px 14px;font-size:12px;font-weight:700;color:#FF9900;">成员</td>
          <td style="padding:10px 14px;font-size:12px;font-weight:700;color:#FF9900;">KPI</td>
          <td style="padding:10px 14px;font-size:12px;font-weight:700;color:#FF9900;">状态</td>
        </tr>`;
      for (const ind of kpi.individuals) {
        body += `<tr style="border-bottom:1px solid #f0f0f0;">
          <td style="padding:10px 14px;font-size:13px;font-weight:600;color:#333;">${esc(ind.name)}</td>
          <td style="padding:10px 14px;font-size:13px;color:#555;">${esc(ind.kpi)}</td>
          <td style="padding:10px 14px;"><span style="color:${statusColor(ind.status)};font-weight:600;font-size:12px;">${statusLabel(ind.status)}</span></td>
        </tr>`;
      }
      body += `</table>`;
    }
    body += `</td></tr>`;
  }

  // weekly: announcements
  if (report.announcements && report.announcements.length) {
    body += `<tr><td style="padding:0 32px 24px;">
      <p style="margin:0 0 12px;font-size:13px;font-weight:700;color:#232F3E;text-transform:uppercase;letter-spacing:0.5px;">📢 &nbsp;公司公告</p>`;
    for (const a of report.announcements) {
      body += `<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:8px;"><tr>
        <td style="padding:10px 14px;background:#f8f9fa;border-radius:6px;border-left:3px solid #232F3E;font-size:13px;color:#333;line-height:1.6;">
          <strong>${esc(a.title)}</strong>${a.detail ? `<br><span style="color:#555;">${esc(a.detail)}</span>` : ""}${a.owner ? `<br><span style="color:#879596;font-size:12px;">发布：${esc(a.owner)}</span>` : ""}
        </td>
      </tr></table>`;
    }
    body += `</td></tr>`;
  }

  // weekly: projectReviews
  if (report.projectReviews && report.projectReviews.length) {
    for (const pr of report.projectReviews) {
      body += `<tr><td style="padding:0 32px 24px;">
        <p style="margin:0 0 12px;font-size:13px;font-weight:700;color:#232F3E;text-transform:uppercase;letter-spacing:0.5px;">🗂 &nbsp;${esc(pr.project)}</p>`;
      if (pr.progress) {
        body += `<p style="margin:0 0 12px;font-size:13px;color:#555;line-height:1.6;padding:10px 14px;background:#f8f9fa;border-radius:6px;">${esc(pr.progress)}</p>`;
      }
      // highlights + lowlights
      if ((pr.highlights&&pr.highlights.length)||(pr.lowlights&&pr.lowlights.length)) {
        body += `<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:10px;">`;
        if (pr.highlights && pr.highlights.length) {
          for (const h of pr.highlights) {
            body += `<tr><td style="padding:6px 14px 6px 0;font-size:13px;color:#333;"><span style="color:#2e7d32;margin-right:6px;">▲</span><strong>${esc(h.point)}</strong>${h.detail?`<span style="color:#666;"> — ${esc(h.detail)}</span>`:""}</td></tr>`;
          }
        }
        if (pr.lowlights && pr.lowlights.length) {
          for (const l of pr.lowlights) {
            body += `<tr><td style="padding:6px 14px 6px 0;font-size:13px;color:#333;"><span style="color:#e65100;margin-right:6px;">▼</span><strong>${esc(l.point)}</strong>${l.detail?`<span style="color:#666;"> — ${esc(l.detail)}</span>`:""}</td></tr>`;
          }
        }
        body += `</table>`;
      }
      // risks
      if (pr.risks && pr.risks.length) {
        for (const r of pr.risks) {
          body += `<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:6px;"><tr>
            <td style="padding:8px 14px;background:#fff8e1;border-radius:6px;border-left:3px solid #FF9900;font-size:13px;color:#333;line-height:1.5;">
              ⚠️ <strong>${esc(r.risk)}</strong> ${impactBadge(r.impact)}${r.mitigation?`<br><span style="color:#666;font-size:12px;">${esc(r.mitigation)}</span>`:""}
            </td>
          </tr></table>`;
        }
      }
      // challenges
      if (pr.challenges && pr.challenges.length) {
        for (const c of pr.challenges) {
          body += `<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:6px;"><tr>
            <td style="padding:8px 14px;background:#fce4ec;border-radius:6px;border-left:3px solid #e53935;font-size:13px;color:#333;line-height:1.5;">
              🔴 <strong>${esc(c.challenge)}</strong>${c.detail?`<br><span style="color:#666;font-size:12px;">${esc(c.detail)}</span>`:""}
            </td>
          </tr></table>`;
        }
      }
      // followUps
      if (pr.followUps && pr.followUps.length) {
        body += `<table width="100%" cellpadding="0" cellspacing="0" style="border-radius:6px;overflow:hidden;border:1px solid #e8edf2;margin-top:8px;">
          <tr style="background:#f5f5f5;">
            <td style="padding:8px 12px;font-size:11px;font-weight:700;color:#555;">跟进事项</td>
            <td style="padding:8px 12px;font-size:11px;font-weight:700;color:#555;">负责人</td>
            <td style="padding:8px 12px;font-size:11px;font-weight:700;color:#555;">截止</td>
          </tr>`;
        for (const f of pr.followUps) {
          body += `<tr style="border-top:1px solid #f0f0f0;">
            <td style="padding:8px 12px;font-size:13px;color:#333;">${esc(f.task)}</td>
            <td style="padding:8px 12px;font-size:13px;color:#555;">${esc(f.owner||"-")}</td>
            <td style="padding:8px 12px;font-size:13px;color:#666;">${esc(f.deadline||"-")}</td>
          </tr>`;
        }
        body += `</table>`;
      }
      body += `</td></tr>`;
    }
  }

  // customer: customerInfo + awsAttendees
  if (report.customerInfo || (report.awsAttendees && report.awsAttendees.length)) {
    const ci = report.customerInfo || {};
    const awsAtt = report.awsAttendees || [];
    body += `<tr><td style="padding:0 32px 24px;">
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

  // customer: customerNeeds
  if (report.customerNeeds && report.customerNeeds.length) {
    body += `<tr><td style="padding:0 32px 24px;">
      <p style="margin:0 0 12px;font-size:13px;font-weight:700;color:#232F3E;text-transform:uppercase;letter-spacing:0.5px;">🎯 &nbsp;客户需求</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-radius:6px;overflow:hidden;border:1px solid #e8edf2;">
        <tr style="background:#232F3E;">
          <td style="padding:10px 14px;font-size:12px;font-weight:700;color:#FF9900;">需求</td>
          <td style="padding:10px 14px;font-size:12px;font-weight:700;color:#FF9900;">优先级</td>
          <td style="padding:10px 14px;font-size:12px;font-weight:700;color:#FF9900;">背景</td>
        </tr>`;
    for (const n of report.customerNeeds) {
      body += `<tr style="border-bottom:1px solid #f0f0f0;">
        <td style="padding:10px 14px;font-size:13px;color:#333;font-weight:600;">${esc(n.need)}</td>
        <td style="padding:10px 14px;">${priorityBadge(n.priority)}</td>
        <td style="padding:10px 14px;font-size:13px;color:#555;">${esc(n.background||"-")}</td>
      </tr>`;
    }
    body += `</table></td></tr>`;
  }

  // customer: painPoints
  if (report.painPoints && report.painPoints.length) {
    body += `<tr><td style="padding:0 32px 24px;">
      <p style="margin:0 0 12px;font-size:13px;font-weight:700;color:#232F3E;text-transform:uppercase;letter-spacing:0.5px;">⚡ &nbsp;客户痛点</p>`;
    for (const p of report.painPoints) {
      body += `<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:6px;"><tr>
        <td style="padding:8px 14px;background:#fff8e1;border-radius:6px;border-left:3px solid #FF9900;font-size:13px;color:#333;line-height:1.5;">
          <strong>${esc(p.point)}</strong>${p.detail?`<br><span style="color:#666;font-size:12px;">${esc(p.detail)}</span>`:""}
        </td>
      </tr></table>`;
    }
    body += `</td></tr>`;
  }

  // customer: solutionsDiscussed
  if (report.solutionsDiscussed && report.solutionsDiscussed.length) {
    body += `<tr><td style="padding:0 32px 24px;">
      <p style="margin:0 0 12px;font-size:13px;font-weight:700;color:#232F3E;text-transform:uppercase;letter-spacing:0.5px;">💡 &nbsp;讨论方案</p>`;
    for (const s of report.solutionsDiscussed) {
      body += `<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:8px;"><tr>
        <td style="padding:10px 14px;background:#f8f9fa;border-radius:6px;border-left:3px solid #232F3E;font-size:13px;color:#333;line-height:1.6;">
          <strong>${esc(s.solution)}</strong>
          ${s.awsServices && s.awsServices.length ? `<br>${s.awsServices.map(svc => `<span style="display:inline-block;background:#232F3E;color:#FF9900;font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;margin-right:4px;margin-top:4px;">${esc(svc)}</span>`).join("")}` : ""}
          ${s.customerFeedback ? `<br><span style="color:#555;font-size:12px;font-style:italic;">客户反馈：${esc(s.customerFeedback)}</span>` : ""}
        </td>
      </tr></table>`;
    }
    body += `</td></tr>`;
  }

  // customer: commitments
  if (report.commitments && report.commitments.length) {
    body += `<tr><td style="padding:0 32px 24px;">
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
      body += `<tr style="border-bottom:1px solid #f0f0f0;border-left:4px solid ${borderColor};">
        <td style="padding:10px 14px;font-size:13px;color:#333;font-weight:600;">${esc(c.party||"-")}</td>
        <td style="padding:10px 14px;font-size:13px;color:#333;">${esc(c.commitment)}</td>
        <td style="padding:10px 14px;font-size:13px;color:#555;">${esc(c.owner||"-")}</td>
        <td style="padding:10px 14px;font-size:13px;color:#666;">${esc(c.deadline||"-")}</td>
      </tr>`;
    }
    body += `</table></td></tr>`;
  }

  // customer: nextSteps
  if (report.nextSteps && report.nextSteps.length) {
    body += `<tr><td style="padding:0 32px 24px;">
      <p style="margin:0 0 12px;font-size:13px;font-weight:700;color:#232F3E;text-transform:uppercase;letter-spacing:0.5px;">➡️ &nbsp;下一步行动</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-radius:6px;overflow:hidden;border:1px solid #e8edf2;">
        <tr style="background:#232F3E;">
          <td style="padding:10px 14px;font-size:12px;font-weight:700;color:#FF9900;">任务</td>
          <td style="padding:10px 14px;font-size:12px;font-weight:700;color:#FF9900;">负责人</td>
          <td style="padding:10px 14px;font-size:12px;font-weight:700;color:#FF9900;">截止</td>
          <td style="padding:10px 14px;font-size:12px;font-weight:700;color:#FF9900;">优先级</td>
        </tr>`;
    for (const ns of report.nextSteps) {
      body += `<tr style="border-top:1px solid #f0f0f0;">
        <td style="padding:10px 14px;font-size:13px;color:#333;">${esc(ns.task)}</td>
        <td style="padding:10px 14px;font-size:13px;color:#333;font-weight:600;">${esc(ns.owner||"-")}</td>
        <td style="padding:10px 14px;font-size:13px;color:#666;">${esc(ns.deadline||"-")}</td>
        <td style="padding:10px 14px;">${priorityBadge(ns.priority)}</td>
      </tr>`;
    }
    body += `</table></td></tr>`;
  }

  // highlights (general/tech)
  if (report.highlights && report.highlights.length && !report.projectReviews) {
    body += `<tr><td style="padding:0 32px 24px;">
      <p style="margin:0 0 12px;font-size:13px;font-weight:700;color:#232F3E;text-transform:uppercase;letter-spacing:0.5px;">✨ &nbsp;亮点</p>`;
    for (const h of report.highlights) {
      body += `<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:6px;"><tr>
        <td style="padding:8px 14px;font-size:13px;color:#333;line-height:1.6;">
          <span style="color:#2e7d32;margin-right:8px;">▲</span><strong>${esc(h.point)}</strong>${h.detail?`<br><span style="color:#666;padding-left:20px;display:inline-block;">${esc(h.detail)}</span>`:""}
        </td>
      </tr></table>`;
    }
    body += `</td></tr>`;
  }

  // lowlights (general/tech)
  if (report.lowlights && report.lowlights.length && !report.projectReviews) {
    body += `<tr><td style="padding:0 32px 24px;">
      <p style="margin:0 0 12px;font-size:13px;font-weight:700;color:#232F3E;text-transform:uppercase;letter-spacing:0.5px;">⚠️ &nbsp;风险 / 问题</p>`;
    for (const l of report.lowlights) {
      body += `<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:6px;"><tr>
        <td style="padding:8px 14px;background:#fff8e1;border-radius:6px;border-left:3px solid #FF9900;font-size:13px;color:#333;line-height:1.5;">
          <strong>${esc(l.point)}</strong>${l.detail?`<br><span style="color:#666;font-size:12px;">${esc(l.detail)}</span>`:""}
        </td>
      </tr></table>`;
    }
    body += `</td></tr>`;
  }

  // decisions
  if (report.decisions && report.decisions.length) {
    body += `<tr><td style="padding:0 32px 24px;">
      <p style="margin:0 0 12px;font-size:13px;font-weight:700;color:#232F3E;text-transform:uppercase;letter-spacing:0.5px;">🔑 &nbsp;关键决策</p>`;
    for (const d of report.decisions) {
      body += `<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:8px;"><tr>
        <td style="padding:10px 14px;background:#f8f9fa;border-radius:6px;border-left:3px solid #232F3E;font-size:13px;color:#333;line-height:1.6;">
          <strong>${esc(d.decision)}</strong>${d.rationale?`<br><span style="color:#666;font-size:12px;">${esc(d.rationale)}</span>`:""}${d.owner?`<span style="color:#879596;font-size:12px;"> — ${esc(d.owner)}</span>`:""}
        </td>
      </tr></table>`;
    }
    body += `</td></tr>`;
  }

  // actions
  if (report.actions && report.actions.length) {
    body += `<tr><td style="padding:0 32px 24px;">
      <p style="margin:0 0 12px;font-size:13px;font-weight:700;color:#232F3E;text-transform:uppercase;letter-spacing:0.5px;">✅ &nbsp;行动项</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-radius:6px;overflow:hidden;border:1px solid #e8edf2;">
        <tr style="background:#232F3E;">
          <td style="padding:10px 14px;font-size:12px;font-weight:700;color:#FF9900;">负责人</td>
          <td style="padding:10px 14px;font-size:12px;font-weight:700;color:#FF9900;">任务</td>
          <td style="padding:10px 14px;font-size:12px;font-weight:700;color:#FF9900;">截止</td>
          <td style="padding:10px 14px;font-size:12px;font-weight:700;color:#FF9900;">优先级</td>
        </tr>`;
    for (const a of report.actions) {
      body += `<tr style="border-top:1px solid #f0f0f0;">
        <td style="padding:10px 14px;font-size:13px;color:#333;font-weight:600;">${esc(a.owner||"-")}</td>
        <td style="padding:10px 14px;font-size:13px;color:#333;">${esc(a.task)}</td>
        <td style="padding:10px 14px;font-size:13px;color:#666;">${esc(a.deadline||"-")}</td>
        <td style="padding:10px 14px;">${priorityBadge(a.priority)}</td>
      </tr>`;
    }
    body += `</table></td></tr>`;
  }

  // participants footer bar
  if (participants.length) {
    body += `<tr><td style="padding:0 32px 24px;">
      <p style="margin:0 0 6px;font-size:11px;font-weight:700;color:#879596;text-transform:uppercase;letter-spacing:0.5px;">参会人员（${participants.length}人）</p>
      <p style="margin:0;font-size:13px;color:#666;">${participants.map(esc).join(" · ")}</p>
      ${duration ? `<p style="margin:4px 0 0;font-size:12px;color:#879596;">会议时长：${esc(duration)}</p>` : ""}
    </td></tr>`;
  }

  const html = `<!DOCTYPE html>
<html lang="zh">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:20px 0;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">

<!-- Header -->
<tr><td style="background:#232F3E;padding:24px 32px;">
  <table width="100%" cellpadding="0" cellspacing="0"><tr>
    <td><span style="color:#FF9900;font-size:18px;font-weight:700;letter-spacing:1px;">▲ Meeting Minutes</span>
      <p style="color:#aab7c4;margin:6px 0 0;font-size:13px;">自动生成 · FunASR + Claude on AWS Bedrock</p></td>
    <td align="right" style="vertical-align:top;"><span style="background:#FF9900;color:#232F3E;font-size:11px;font-weight:700;padding:4px 10px;border-radius:12px;">已完成</span></td>
  </tr></table>
</td></tr>

<!-- Meta -->
<tr><td style="background:#2d3d50;padding:14px 32px;">
  <table width="100%" cellpadding="0" cellspacing="0"><tr>
    <td style="color:#e8edf2;font-size:15px;font-weight:600;">${esc(name)}</td>
    <td align="right" style="color:#8899aa;font-size:13px;">${esc(date)}${duration ? ` &nbsp;|&nbsp; ${esc(duration)}` : ""}${participants.length ? ` &nbsp;|&nbsp; ${participants.length}人` : ""}</td>
  </tr></table>
</td></tr>

<!-- Spacer -->
<tr><td style="height:24px;"></td></tr>

${body}

<!-- Footer -->
<tr><td style="background:#f8f9fa;padding:16px 32px;border-top:1px solid #e8edf2;">
  <p style="margin:0;font-size:11px;color:#879596;text-align:center;">
    由 Meeting Minutes 自动生成 · <a href="https://minutes.yc-wgr.com" style="color:#879596;">minutes.yc-wgr.com</a><br>
    转录引擎：FunASR (CAM++ 说话人分离) &nbsp;·&nbsp; 报告引擎：Claude on AWS Bedrock
  </p>
</td></tr>

</table>
</td></tr>
</table>
</body></html>`;
  return html;
}

/* ─── SES email ───────────────────────────────────────── */

async function sendEmail({ to, subject, htmlBody }) {
  const toAddresses = Array.isArray(to) ? to : [to];
  const from = process.env.SES_FROM_EMAIL;

  await ses.send(new SendEmailCommand({
    Source: from,
    Destination: { ToAddresses: toAddresses },
    Message: {
      Subject: { Data: subject, Charset: "UTF-8" },
      Body: { Html: { Data: htmlBody, Charset: "UTF-8" } },
    },
  }));
}

/* ─── main processing ─────────────────────────────────── */

async function processMessage(message) {
  const body = JSON.parse(message.Body);
  const { meetingId, reportKey, createdAt } = body;
  console.log(`[export-worker] Processing meeting ${meetingId}`);

  // Update stage to "sending"
  await docClient.send(new UpdateCommand({
    TableName: TABLE,
    Key: { meetingId, createdAt },
    UpdateExpression: "SET stage = :stage, updatedAt = :u",
    ExpressionAttributeValues: { ":stage": "sending", ":u": nowISO() },
  }));

  try {
    // 1. Read report from S3
    const reportStream = await getFile(reportKey);
    const report = JSON.parse(await streamToString(reportStream));
    console.log(`[export-worker] Report loaded for ${meetingId}`);

    // 2. Build HTML email and send via SES
    const meetingType = report.meetingType || "会议";
    const date = report.date || fmtDate(nowISO());
    const subject = `【会议纪要】${meetingType} - ${date}`;
    const htmlBody = buildHtmlBody(report, body.meetingName || meetingId);

    // Resolve recipient emails: check DynamoDB for custom recipients
    const defaultTo = process.env.SES_TO_EMAIL;
    let recipientEmails = [];
    try {
      const { Item } = await docClient.send(new GetCommand({
        TableName: TABLE,
        Key: { meetingId, createdAt },
        ProjectionExpression: "recipientEmails",
      }));
      if (Item && Item.recipientEmails && Item.recipientEmails.length) {
        recipientEmails = Item.recipientEmails;
      }
    } catch (err) {
      console.warn(`[export-worker] Failed to read recipientEmails: ${err.message}`);
    }

    if (recipientEmails.length) {
      // Send to custom recipients, BCC default
      const toAddresses = recipientEmails;
      const from = process.env.SES_FROM_EMAIL;
      const bcc = defaultTo ? [defaultTo] : [];
      await ses.send(new SendEmailCommand({
        Source: from,
        Destination: { ToAddresses: toAddresses, BccAddresses: bcc },
        Message: {
          Subject: { Data: subject, Charset: "UTF-8" },
          Body: { Html: { Data: htmlBody, Charset: "UTF-8" } },
        },
      }));
      console.log(`[export-worker] Email sent to ${toAddresses.join(", ")} (BCC: ${defaultTo || "none"})`);
    } else if (defaultTo) {
      await sendEmail({ to: defaultTo, subject, htmlBody });
      console.log(`[export-worker] Email sent to ${defaultTo}`);
    } else {
      console.warn("[export-worker] SES_TO_EMAIL not set and no recipientEmails, skipping email");
    }

    // 3. Update DynamoDB status to "completed", stage to "done"
    await docClient.send(new UpdateCommand({
      TableName: TABLE,
      Key: { meetingId, createdAt },
      UpdateExpression: "SET #s = :s, exportedAt = :ea, updatedAt = :u, stage = :stage",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: {
        ":s": "completed",
        ":ea": nowISO(),
        ":u": nowISO(),
        ":stage": "done",
      },
    }));
    console.log(`[export-worker] Meeting ${meetingId} marked as completed`);
  } catch (err) {
    console.error(`[export-worker] Failed for meeting ${meetingId}:`, err.message);
    try {
      await docClient.send(new UpdateCommand({
        TableName: TABLE,
        Key: { meetingId, createdAt },
        UpdateExpression: "SET #s = :s, errorMessage = :em, stage = :stage, updatedAt = :u",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: {
          ":s": "failed",
          ":em": err.message,
          ":stage": "failed",
          ":u": nowISO(),
        },
      }));
    } catch (updateErr) {
      console.error('[export-worker] Failed to update error status:', updateErr.message);
    }
    throw err; // Re-throw so message is NOT deleted from SQS (visibility timeout retry)
  }
}

/* ─── polling loop ────────────────────────────────────── */

async function poll() {
  console.log("[export-worker] Started, polling mm-export-queue...");
  while (true) {
    try {
      const messages = await receiveMessages(QUEUE_URL);
      for (const msg of messages) {
        try {
          await processMessage(msg);
          await deleteMessage(QUEUE_URL, msg.ReceiptHandle);
        } catch (err) {
          console.error(`[export-worker] Failed to process message:`, err);
        }
      }
    } catch (err) {
      console.error("[export-worker] Poll error:", err);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL));
  }
}

poll();
