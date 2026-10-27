import { describe, it, expect } from "vitest";
import { REVIEW_THRESHOLD } from "../confidence";

describe("REVIEW_THRESHOLD", () => {
  it("marks the review threshold at 0.7", () => {
    expect(REVIEW_THRESHOLD).toBe(0.7);
  });
});
