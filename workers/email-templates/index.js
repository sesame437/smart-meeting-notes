const { fmtDate, buildSummary, buildParticipantsFooter, buildHtmlWrapper } = require("./base");
const { buildGeneralBody } = require("./general");
const { buildWeeklyBody } = require("./weekly");
const { buildCustomerBody } = require("./customer");

/* ─── Main entry point ──────────────────────────────────── */

function buildHtmlBody(report, meetingName) {
  const name = meetingName || report.meetingType || "会议";
  const date = report.date || fmtDate(new Date().toISOString());
  const participants = report.participants || [];
  const duration = report.duration || "";

  // Build body content based on meeting type
  let bodyContent = "";
  bodyContent += buildSummary(report);

  const meetingType = (report.meetingType || "general").toLowerCase();
  if (meetingType === "weekly") {
    bodyContent += buildWeeklyBody(report);
  } else if (meetingType === "customer") {
    bodyContent += buildCustomerBody(report);
  } else {
    // general, tech, or other types
    bodyContent += buildGeneralBody(report);
  }

  bodyContent += buildParticipantsFooter(participants, duration);

  // Wrap in complete HTML structure
  return buildHtmlWrapper(name, date, participants, duration, bodyContent);
}

module.exports = buildHtmlBody;
