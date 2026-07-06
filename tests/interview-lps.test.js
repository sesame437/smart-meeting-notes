"use strict";

const { INTERVIEW_LPS, isValidLP } = require("../services/interview-lps");

describe("INTERVIEW_LPS whitelist", () => {
  test("contains exactly the 10 expected LPs in order", () => {
    expect(INTERVIEW_LPS).toEqual([
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
  });

  test("whitelist is frozen and cannot be mutated", () => {
    expect(Object.isFrozen(INTERVIEW_LPS)).toBe(true);
    expect(() => {
      INTERVIEW_LPS.push("New LP");
    }).toThrow();
  });

  test("isValidLP returns true for whitelisted names", () => {
    expect(isValidLP("Ownership")).toBe(true);
    expect(isValidLP("Have Backbone; Disagree and Commit")).toBe(true);
    expect(isValidLP("Bias for Action")).toBe(true);
  });

  test("isValidLP returns false for non-whitelisted names", () => {
    expect(isValidLP("Frugality")).toBe(false);
    expect(isValidLP("ownership")).toBe(false);
    expect(isValidLP("")).toBe(false);
    expect(isValidLP(null)).toBe(false);
    expect(isValidLP(undefined)).toBe(false);
  });
});
