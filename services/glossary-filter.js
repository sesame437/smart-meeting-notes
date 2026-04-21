"use strict";

const MEETING_TYPE_CATEGORIES = {
  weekly:    ["人员", "术语", "组织"],
  general:   ["人员", "术语", "组织"],
  customer:  ["人员", "术语"],
  tech:      ["人员", "术语"],
  interview: ["术语"],
  merged:    ["人员", "术语", "组织"],
};

const ALL_CATEGORIES = ["人员", "术语", "组织"];

function filterGlossaryByMeetingType(items, meetingType) {
  if (!Array.isArray(items) || items.length === 0) return [];
  const allowed = MEETING_TYPE_CATEGORIES[meetingType] || ALL_CATEGORIES;
  return items.filter((item) => {
    const cat = item && item.category;
    if (!cat) return true;
    return allowed.includes(cat);
  });
}

module.exports = {
  filterGlossaryByMeetingType,
  MEETING_TYPE_CATEGORIES,
  ALL_CATEGORIES,
};
