"use strict";

// Single source of truth for the 10 LPs relevant to interview reports.
// Excludes: Are Right A Lot, Hire and Develop the Best, Insist on the Highest Standards,
// Frugality, Strive to be Earth's Best Employer, Success and Scale Bring Broad Responsibility.
// NOTE: keep this list in sync with the frontend copy in public/js/app.js (INTERVIEW_LPS).
const INTERVIEW_LPS = Object.freeze([
  "Learn and Be Curious",
  "Ownership",
  "Customer Obsession",
  "Dive Deep",
  "Have Backbone; Disagree and Commit",
  "Invent and Simplify",
  "Deliver Results",
  "Earn Trust",
  "Think Big",
  "Bias for Action",
]);

const _LP_SET = new Set(INTERVIEW_LPS);

function isValidLP(name) {
  return typeof name === "string" && _LP_SET.has(name);
}

module.exports = { INTERVIEW_LPS, isValidLP };
