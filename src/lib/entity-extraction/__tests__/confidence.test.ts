import { describe, it, expect } from "vitest";
import { isGrounded, normalizeForGrounding, REVIEW_THRESHOLD } from "../confidence";

const DOC = normalizeForGrounding("Policy Summary\nFace Amount   $500,000\nInsured: Michael V Sharesky\nPolicy Type: Term");

describe("isGrounded", () => {
  it("finds a snippet that is in the document", () => {
    expect(isGrounded("Face Amount   $500,000", DOC)).toBe(true);
  });

  it("grounds a snippet whose whitespace and case differ from the document", () => {
    expect(isGrounded("face amount $500,000", DOC)).toBe(true);
  });

  it("does not ground a snippet that is not in the document", () => {
    expect(isGrounded("Face Amount $750,000", DOC)).toBe(false);
  });

  it("does not ground a missing or blank snippet", () => {
    expect(isGrounded(null, DOC)).toBe(false);
    expect(isGrounded("   ", DOC)).toBe(false);
  });
});

describe("REVIEW_THRESHOLD", () => {
  it("marks the review threshold at 0.7", () => {
    expect(REVIEW_THRESHOLD).toBe(0.7);
  });
});
