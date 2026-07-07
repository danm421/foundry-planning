import { describe, it, expect } from "vitest";
import {
  buildCompliancePages,
  complianceFilename,
  buildComplianceRequestPayload,
  COMPLIANCE_RUN_KIND,
  COMPLIANCE_REPORT_TYPE,
} from "../deck";

const NOW = new Date("2026-07-07T12:00:00Z");

describe("compliance deck", () => {
  it("is exactly the Client Profile + Balance Sheet pages", () => {
    const pages = buildCompliancePages(NOW);
    expect(pages.map((p) => p.pageId)).toEqual(["clientProfile", "balanceSheet"]);
    const bs = pages.find((p) => p.pageId === "balanceSheet")!;
    expect(bs.options).toMatchObject({ asOf: "today", includeOutOfEstate: false });
    expect((bs.options as { year: number }).year).toBe(2026);
  });

  it("names the file with an ISO date prefix", () => {
    expect(complianceFilename(NOW)).toBe(
      "2026-07-07 Compliance Snapshot - Profile + Balance Sheet.pdf",
    );
  });

  it("builds a full request payload for a scenario", () => {
    const body = buildComplianceRequestPayload("scn-1", NOW);
    expect(body.scenarioId).toBe("scn-1");
    expect(body.preview).toBe(false);
    expect(body.filename).toBe(complianceFilename(NOW));
    expect(body.pages.map((p) => p.pageId)).toEqual(["clientProfile", "balanceSheet"]);
  });

  it("exposes stable kind + reportType constants", () => {
    expect(COMPLIANCE_RUN_KIND).toBe("compliance_export");
    expect(COMPLIANCE_REPORT_TYPE).toBe("compliance_export");
  });
});
