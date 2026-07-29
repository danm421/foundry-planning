import { describe, it, expect } from "vitest";
import { summarizeEvent } from "../queries";

describe("summarizeEvent", () => {
  it("describes a band crossing driven by the plan", () => {
    expect(
      summarizeEvent({
        kind: "capacity_changed",
        beforeLevel: "moderately_aggressive",
        afterLevel: "moderate",
        reason: "plan change",
      }),
    ).toBe("Planning change moved the profile from Moderately Aggressive to Moderate");
  });

  it("describes a completed questionnaire", () => {
    expect(
      summarizeEvent({
        kind: "rtq_completed",
        beforeLevel: null,
        afterLevel: "moderate",
        reason: null,
      }),
    ).toBe("Risk tolerance questionnaire completed - profile set to Moderate");
  });

  it("carries the advisor's reasoning verbatim for manual changes", () => {
    expect(
      summarizeEvent({
        kind: "tolerance_manual",
        beforeLevel: "moderate",
        afterLevel: "conservative",
        reason: "Client asked to de-risk after selling the business",
      }),
    ).toBe(
      "Tolerance set manually from Moderate to Conservative - Client asked to de-risk after selling the business",
    );
  });

  it("describes an environment change", () => {
    expect(
      summarizeEvent({
        kind: "environment_changed",
        beforeLevel: "moderate",
        afterLevel: "moderately_conservative",
        reason: "Sole earner, employer announced layoffs",
      }),
    ).toBe(
      "Environmental factors updated from Moderate to Moderately Conservative - Sole earner, employer announced layoffs",
    );
  });
});
