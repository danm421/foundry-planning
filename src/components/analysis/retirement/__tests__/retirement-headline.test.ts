import { describe, it, expect } from "vitest";
import {
  buildSummaryHeadline,
  buildProbabilityHeadline,
  buildKpis,
} from "../retirement-headline";
import type { RetirementSummary } from "@/lib/analysis/derive-retirement-summary";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const runsShortJoint: RetirementSummary = {
  assetsRemaining: -125_000,
  ageAssetsLastUntil: { client: 85, spouse: 81 },
  yearsFullyFunded: 22,
  avgPercentFunded: 0.63,
  fullyFunded: false,
};

const fullyFundedJoint: RetirementSummary = {
  assetsRemaining: 850_000,
  ageAssetsLastUntil: null,
  yearsFullyFunded: 30,
  avgPercentFunded: null,
  fullyFunded: true,
};

const runsShortSingleClient: RetirementSummary = {
  assetsRemaining: -50_000,
  ageAssetsLastUntil: { client: 82, spouse: null },
  yearsFullyFunded: 18,
  avgPercentFunded: 0.5,
  fullyFunded: false,
};

const negativeRemainingJoint: RetirementSummary = {
  assetsRemaining: -500_000,
  ageAssetsLastUntil: { client: 78, spouse: 74 },
  yearsFullyFunded: 15,
  avgPercentFunded: 0.4,
  fullyFunded: false,
};

const nullAvgPercentFunded: RetirementSummary = {
  assetsRemaining: 0,
  ageAssetsLastUntil: null,
  yearsFullyFunded: 10,
  avgPercentFunded: null,
  fullyFunded: true,
};

// ---------------------------------------------------------------------------
// buildSummaryHeadline
// ---------------------------------------------------------------------------

describe("buildSummaryHeadline", () => {
  it("runs-short joint: last segment contains ages and is accent", () => {
    const segments = buildSummaryHeadline(runsShortJoint);
    // should have at least one accent segment
    const accentSegments = segments.filter((s) => s.accent === true);
    expect(accentSegments.length).toBeGreaterThan(0);
    // the accent segment should include the ages
    const accentText = accentSegments.map((s) => s.text).join("");
    expect(accentText).toContain("85");
    expect(accentText).toContain("81");
  });

  it("runs-short joint: headline mentions ages in text", () => {
    const segments = buildSummaryHeadline(runsShortJoint);
    const fullText = segments.map((s) => s.text).join("");
    expect(fullText).toContain("85");
    expect(fullText).toContain("81");
  });

  it("fully-funded joint: no ages in text (rest-of-lives phrasing)", () => {
    const segments = buildSummaryHeadline(fullyFundedJoint);
    const fullText = segments.map((s) => s.text).join("");
    // should not mention specific ages — should say "for the rest of" or similar
    expect(fullText).not.toMatch(/\b\d{2}\/\d{2}\b/);
    expect(fullText.toLowerCase()).toMatch(/rest|life|funded|lifetime/);
  });

  it("fully-funded: accent segment does not contain ages slash notation", () => {
    const segments = buildSummaryHeadline(fullyFundedJoint);
    const accentText = segments
      .filter((s) => s.accent)
      .map((s) => s.text)
      .join("");
    expect(accentText).not.toMatch(/\d+\/\d+/);
  });

  it("single-client runs-short: accent segment shows only client age (no slash)", () => {
    const segments = buildSummaryHeadline(runsShortSingleClient);
    const accentText = segments
      .filter((s) => s.accent)
      .map((s) => s.text)
      .join("");
    expect(accentText).toContain("82");
    expect(accentText).not.toContain("/");
  });

  it("returns an array of HeadlineSegment objects with text strings", () => {
    const segments = buildSummaryHeadline(runsShortJoint);
    expect(Array.isArray(segments)).toBe(true);
    for (const seg of segments) {
      expect(typeof seg.text).toBe("string");
    }
  });
});

// ---------------------------------------------------------------------------
// buildProbabilityHeadline
// ---------------------------------------------------------------------------

describe("buildProbabilityHeadline", () => {
  it("0.27 → contains '27%' as an accent segment", () => {
    const segments = buildProbabilityHeadline(0.27);
    const accentTexts = segments.filter((s) => s.accent).map((s) => s.text);
    expect(accentTexts.some((t) => t.includes("27%"))).toBe(true);
  });

  it("1.0 → contains '100%' as an accent segment", () => {
    const segments = buildProbabilityHeadline(1.0);
    const accentTexts = segments.filter((s) => s.accent).map((s) => s.text);
    expect(accentTexts.some((t) => t.includes("100%"))).toBe(true);
  });

  it("0.0 → contains '0%' as an accent segment", () => {
    const segments = buildProbabilityHeadline(0.0);
    const accentTexts = segments.filter((s) => s.accent).map((s) => s.text);
    expect(accentTexts.some((t) => t.includes("0%"))).toBe(true);
  });

  it("full text mentions 'fund' or 'retire' and the percent value", () => {
    const segments = buildProbabilityHeadline(0.65);
    const fullText = segments.map((s) => s.text).join("").toLowerCase();
    expect(fullText).toMatch(/fund|retire/);
    expect(fullText).toContain("65%");
  });
});

// ---------------------------------------------------------------------------
// buildKpis
// ---------------------------------------------------------------------------

describe("buildKpis", () => {
  it("returns exactly 4 KPI items", () => {
    expect(buildKpis(runsShortJoint)).toHaveLength(4);
  });

  it("KPI labels match eMoney labels exactly", () => {
    const kpis = buildKpis(runsShortJoint);
    const labels = kpis.map((k) => k.label);
    expect(labels).toContain("Assets Remaining");
    expect(labels).toContain("Age Assets Last Until");
    expect(labels).toContain("Years Fully Funded");
    expect(labels).toContain("Average Percent Funded in Partially Funded Years");
  });

  it("negative assetsRemaining → Assets Remaining KPI has tone 'crit'", () => {
    const kpis = buildKpis(negativeRemainingJoint);
    const ar = kpis.find((k) => k.label === "Assets Remaining");
    expect(ar?.tone).toBe("crit");
  });

  it("positive assetsRemaining → Assets Remaining KPI tone is not 'crit'", () => {
    const kpis = buildKpis(fullyFundedJoint);
    const ar = kpis.find((k) => k.label === "Assets Remaining");
    expect(ar?.tone).not.toBe("crit");
  });

  it("fully-funded: Age Assets Last Until value is '—'", () => {
    const kpis = buildKpis(fullyFundedJoint);
    const ageKpi = kpis.find((k) => k.label === "Age Assets Last Until");
    expect(ageKpi?.value).toBe("—");
  });

  it("joint runs-short: Age Assets Last Until shows client/spouse format", () => {
    const kpis = buildKpis(runsShortJoint);
    const ageKpi = kpis.find((k) => k.label === "Age Assets Last Until");
    expect(ageKpi?.value).toBe("85/81");
  });

  it("single-client: Age Assets Last Until shows only client age (no slash)", () => {
    const kpis = buildKpis(runsShortSingleClient);
    const ageKpi = kpis.find((k) => k.label === "Age Assets Last Until");
    expect(ageKpi?.value).toBe("82");
    expect(ageKpi?.value).not.toContain("/");
  });

  it("avgPercentFunded null → Average Percent Funded value is '—'", () => {
    const kpis = buildKpis(nullAvgPercentFunded);
    const pf = kpis.find(
      (k) => k.label === "Average Percent Funded in Partially Funded Years",
    );
    expect(pf?.value).toBe("—");
  });

  it("avgPercentFunded 0.63 → value is '63%'", () => {
    const kpis = buildKpis(runsShortJoint);
    const pf = kpis.find(
      (k) => k.label === "Average Percent Funded in Partially Funded Years",
    );
    expect(pf?.value).toBe("63%");
  });

  it("Years Fully Funded shows the integer value", () => {
    const kpis = buildKpis(runsShortJoint);
    const yff = kpis.find((k) => k.label === "Years Fully Funded");
    expect(yff?.value).toBe("22");
  });

  it("all KPIs have non-empty explainer strings", () => {
    const kpis = buildKpis(runsShortJoint);
    for (const kpi of kpis) {
      expect(kpi.explainer.length).toBeGreaterThan(10);
    }
  });

  it("Assets Remaining value is formatted as currency", () => {
    const kpis = buildKpis(runsShortJoint);
    const ar = kpis.find((k) => k.label === "Assets Remaining");
    // formatCurrency of -125000 → "−$125,000"
    expect(ar?.value).toContain("$");
  });
});
