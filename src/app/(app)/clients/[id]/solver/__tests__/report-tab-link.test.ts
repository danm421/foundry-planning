import { describe, it, expect } from "vitest";
import { resolveInputTab, resolveReportParam, solverViewQuery } from "../report-tab-link";

describe("solver view URL params", () => {
  it("keeps the scenario and records only non-default views", () => {
    const current = new URLSearchParams("scenario=s1&tab=education");
    expect(solverViewQuery(current, "changes", "taxBracket")).toBe(
      "?scenario=s1&tab=changes&report=taxBracket",
    );
    expect(solverViewQuery(current, "retirement", "portfolio")).toBe("?scenario=s1");
    expect(solverViewQuery(new URLSearchParams(), "retirement", "portfolio")).toBe("");
  });

  it("falls back to the defaults for a missing or unknown value", () => {
    expect(resolveInputTab("changes")).toBe("changes");
    expect(resolveInputTab("bogus")).toBe("retirement");
    expect(resolveInputTab(undefined)).toBe("retirement");
    expect(resolveReportParam("monteCarlo")).toBe("monteCarlo");
    expect(resolveReportParam("thresholds")).toBe("portfolio");
  });
});
