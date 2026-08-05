import { describe, it, expect } from "vitest";
import { renderToBuffer } from "@react-pdf/renderer";
import { renderToTree } from "@/components/pdf/test-utils/render-tree";
import {
  RiskProfilePdfDocument,
  type RiskEventLine,
  type RiskProfilePdfProps,
} from "../risk-profile-pdf-document";
import type { CapacityFactors } from "@/lib/insights/risk-capacity";
import type { RiskDetailRow, RiskListFlags } from "@/lib/risk/queries";

const row = (over: Partial<RiskDetailRow> = {}): RiskDetailRow => ({
  clientId: "c1",
  householdName: "Sam & Casey Cooper",
  compositeScore: 41,
  compositeLevel: "moderately_conservative",
  bindingConstraint: "capacity",
  toleranceScore: 70,
  toleranceSource: "rtq_client",
  toleranceConfirmedAt: new Date("2026-03-04T00:00:00Z"),
  capacityScore: 41,
  environmentAdj: -5,
  environmentReason: "Concentrated employer stock outside the plan",
  requiredGrowthPct: null,
  updatedAt: new Date("2026-07-01T00:00:00Z"),
  spouseToleranceScore: 62,
  capacityComputedAt: new Date("2026-06-30T00:00:00Z"),
  ...over,
});

const flags = (over: Partial<RiskListFlags> = {}): RiskListFlags => ({
  notEstablished: false,
  reviewDue: false,
  capacityConstrained: true,
  goalsOverReaching: false,
  capacityPending: false,
  ...over,
});

// Deliberately asymmetric: every factor sits at a different fraction of its own
// ceiling, so a swapped key or a ceiling read off the wrong weight changes the
// rendered "x / y" pairs instead of leaving them coincidentally equal.
const factors: CapacityFactors = {
  runway: 0.25, // ceiling 0.50 -> 25 / 50
  incomeFloor: 0.12, // ceiling 0.48 -> 12 / 48
  retirementHorizon: 0.09, // ceiling 0.15 -> 9 / 15
  withdrawal: 0.15, // ceiling 0.15 -> 15 / 15
  buffer: 0, // ceiling 0.15 -> 0 / 15
};

const events: RiskEventLine[] = [
  {
    id: "e1",
    date: "2026-06-30",
    summary: "Planning change moved the profile from moderate to Moderately Conservative",
    actor: "System",
  },
  {
    id: "e2",
    date: "2026-03-04",
    summary: "Risk tolerance questionnaire completed - profile set to Moderately Aggressive",
    actor: "Client",
  },
];

const props = (over: Partial<RiskProfilePdfProps> = {}): RiskProfilePdfProps => ({
  row: row(),
  flags: flags(),
  factors,
  mismatch: {
    kind: "mismatch",
    level: "moderately_conservative",
    targetName: "Conservative Growth 40/60",
    applyToPortfolioId: "p1",
    buckets: [
      { label: "Taxable", value: "Balanced 60/40" },
      { label: "Retirement", value: "Balanced 60/40" },
    ],
  },
  events,
  generatedAt: "Aug 5, 2026, 9:15 AM",
  firmName: "Ethos Financial Group",
  logoDataUrl: null,
  ...over,
});

describe("RiskProfilePdfDocument", () => {
  it("renders the composite headline, the three components, and the binding constraint", () => {
    const tree = renderToTree(<RiskProfilePdfDocument {...props()} />);
    expect(tree).toContain("Sam &amp; Casey Cooper");
    expect(tree).toContain("Ethos Financial Group");
    expect(tree).toContain("Moderately Conservative");
    expect(tree).toContain("Capacity is the binding constraint");
    // Tolerance component: score, source, confirmation date, spouse rider.
    expect(tree).toContain("Client RTQ");
    expect(tree).toContain("2026-03-04");
    expect(tree).toContain("Spouse 62");
    // Environment carries its sign and the advisor's own words.
    expect(tree).toContain(">-5</TEXT>");
    expect(tree).toContain("Concentrated employer stock outside the plan");
  });

  it("draws each capacity factor against its own weight ceiling", () => {
    const tree = renderToTree(<RiskProfilePdfDocument {...props()} />);
    expect(tree).toContain("Years to retirement");
    expect(tree).toContain("25 / 50");
    expect(tree).toContain("12 / 48");
    expect(tree).toContain("9 / 15");
    expect(tree).toContain("15 / 15");
    expect(tree).toContain("0 / 15");
    // A maxed factor fills its bar; an empty one draws none.
    expect(tree).toContain("width:100%");
    expect(tree).toContain("width:0%");
    // runway 0.25 / ceiling 0.50 — not 25% of the whole score.
    expect(tree).toContain("width:50%");
  });

  it("prints every change-log row with its date, summary, and actor", () => {
    const tree = renderToTree(<RiskProfilePdfDocument {...props()} />);
    expect(tree).toContain("Change log");
    for (const e of events) {
      expect(tree).toContain(e.date);
      expect(tree).toContain(e.summary);
    }
    // Anchored to the cell's closing tag — a bare "Client" would also match the
    // "Client RTQ" tolerance source in the panel above.
    expect(tree).toContain(">System</TEXT>");
    expect(tree).toContain(">Client</TEXT>");
    expect(tree).not.toContain("No changes recorded yet.");
  });

  it("says so when there is no history rather than printing an empty table", () => {
    const tree = renderToTree(<RiskProfilePdfDocument {...props({ events: [] })} />);
    expect(tree).toContain("No changes recorded yet.");
  });

  it("names the portfolio the profile calls for when the plan is not running on it", () => {
    const tree = renderToTree(<RiskProfilePdfDocument {...props()} />);
    expect(tree).toContain("Portfolio alignment");
    expect(tree).toContain("Conservative Growth 40/60");
    expect(tree).toContain("The plan is not running on it.");
    expect(tree).toContain("Balanced 60/40");
  });

  it("drops the alignment section entirely when there is no profile to compare", () => {
    const tree = renderToTree(
      <RiskProfilePdfDocument {...props({ mismatch: { kind: "no_profile" } })} />,
    );
    expect(tree).not.toContain("Portfolio alignment");
  });

  it("renders the planless household without capacity bars or a computed-on date", () => {
    const tree = renderToTree(
      <RiskProfilePdfDocument
        {...props({
          row: row({
            capacityScore: null,
            capacityComputedAt: null,
            compositeScore: 65,
            bindingConstraint: "none",
          }),
          flags: flags({ capacityPending: true, capacityConstrained: false }),
          factors: null,
        })}
      />,
    );
    expect(tree).toContain("No plan yet");
    expect(tree).toContain("No capacity yet");
    expect(tree).not.toContain("What drives capacity");
    expect(tree).not.toContain("Years to retirement");
  });

  it("raises the over-reaching goals callout only when the flag and both figures are present", () => {
    const overReaching = props({
      row: row({ requiredGrowthPct: 78, capacityScore: 41 }),
      flags: flags({ goalsOverReaching: true }),
    });
    expect(renderToTree(<RiskProfilePdfDocument {...overReaching} />)).toContain(
      "needs 78% growth exposure",
    );
    // Flag set but the figure never computed — no half-written sentence.
    const missingFigure = props({
      row: row({ requiredGrowthPct: null }),
      flags: flags({ goalsOverReaching: true }),
    });
    expect(renderToTree(<RiskProfilePdfDocument {...missingFigure} />)).not.toContain(
      "growth exposure",
    );
  });

  it("renders a non-trivial PDF binary", async () => {
    const buffer = await renderToBuffer(<RiskProfilePdfDocument {...props()} />);
    expect(buffer.length).toBeGreaterThan(2000);
  }, 30000);
});
