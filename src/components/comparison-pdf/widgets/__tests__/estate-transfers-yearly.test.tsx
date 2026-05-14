import { describe, expect, it } from "vitest";
import { renderToTree } from "@/components/pdf/test-utils/render-tree";
import {
  EstateTransfersYearlyBlock,
  EstateTransfersYearlyPdf,
  filterVisibleCols,
  type OuterCol,
} from "../estate-transfers-yearly";
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";
import type {
  YearlyEstateDeathRow,
  YearlyEstateReport,
  YearlyEstateRow,
} from "@/lib/estate/yearly-estate-report";

const branding = { primaryColor: "#000", firmName: "x", logoDataUrl: null };

function mkDeath(
  args: Partial<YearlyEstateDeathRow> & {
    deathOrder: 1 | 2;
    deceased: "client" | "spouse";
    decedentName: string;
  },
): YearlyEstateDeathRow {
  return {
    deathOrder: args.deathOrder,
    deceased: args.deceased,
    decedentName: args.decedentName,
    estateValue: args.estateValue ?? 0,
    taxableEstate: args.taxableEstate ?? 0,
    charitableDeduction: args.charitableDeduction ?? 0,
    stateEstateTax: args.stateEstateTax ?? 0,
    probateAndExpenses: args.probateAndExpenses ?? 0,
    incomeTaxOnIRD: args.incomeTaxOnIRD ?? 0,
    estateTaxPayable: args.estateTaxPayable ?? 0,
    totalTaxAtDeath: args.totalTaxAtDeath ?? 0,
  };
}

function mkRow(
  args: Partial<YearlyEstateRow> & { year: number },
): YearlyEstateRow {
  return {
    year: args.year,
    ageClient: args.ageClient ?? null,
    ageSpouse: args.ageSpouse ?? null,
    grossEstate: args.grossEstate ?? 0,
    taxesAndExpenses: args.taxesAndExpenses ?? 0,
    charitableBequests: args.charitableBequests ?? 0,
    netToHeirs: args.netToHeirs ?? 0,
    heirsAssets: args.heirsAssets ?? 0,
    totalToHeirs: args.totalToHeirs ?? 0,
    charity: args.charity ?? 0,
    deaths: args.deaths ?? [],
  };
}

function mkReport(args: Partial<YearlyEstateReport>): YearlyEstateReport {
  return {
    ordering: args.ordering ?? "primaryFirst",
    rows: args.rows ?? [],
    totals: args.totals ?? {
      taxesAndExpenses: 0,
      charitableBequests: 0,
      netToHeirs: 0,
      heirsAssets: 0,
      totalToHeirs: 0,
      charity: 0,
    },
  };
}

function mkPlan(args: { id?: string; label?: string } = {}): ComparisonPlan {
  return {
    id: args.id ?? "p1",
    label: args.label ?? "A",
    tree: {
      client: {
        firstName: "Avery",
        dateOfBirth: "1975-06-20",
        filingStatus: "married_joint",
        spouseDob: "1979-01-01",
        spouseName: "Blake",
        retirementAge: 65,
      },
      familyMembers: [],
      accounts: [],
      planSettings: { planStartYear: 2025, inflationRate: 0 },
    },
    result: {
      years: [],
    },
  } as unknown as ComparisonPlan;
}

const ownerNames = { clientName: "Cooper", spouseName: "Susan" };

describe("filterVisibleCols (pure helper)", () => {
  const ALL_COLS: OuterCol[] = [
    { key: "grossEstate", label: "Gross Estate" },
    { key: "taxesAndExpenses", label: "Taxes & Expenses", totalKey: "taxesAndExpenses" },
    { key: "charitableBequests", label: "Charitable Bequests", totalKey: "charitableBequests" },
    { key: "netToHeirs", label: "Net To Heirs", totalKey: "netToHeirs" },
    { key: "heirsAssets", label: "Heirs Assets" },
    { key: "totalToHeirs", label: "Total To Heirs", totalKey: "totalToHeirs" },
    { key: "charity", label: "Charity", totalKey: "charity" },
  ];

  it("keeps columns with non-zero values", () => {
    const report = mkReport({
      rows: [mkRow({ year: 2030, grossEstate: 1000, charity: 0 })],
      totals: {
        taxesAndExpenses: 0,
        charitableBequests: 0,
        netToHeirs: 0,
        heirsAssets: 0,
        totalToHeirs: 0,
        charity: 0,
      },
    });
    const cols = filterVisibleCols(ALL_COLS, report);
    expect(cols.find((c) => c.key === "grossEstate")).toBeDefined();
  });

  it("drops a column whose row values are all zero AND total is zero/undefined", () => {
    const report = mkReport({
      rows: [mkRow({ year: 2030, grossEstate: 1000, charity: 0 })],
      totals: {
        taxesAndExpenses: 0,
        charitableBequests: 0,
        netToHeirs: 0,
        heirsAssets: 0,
        totalToHeirs: 0,
        charity: 0,
      },
    });
    const cols = filterVisibleCols(ALL_COLS, report);
    expect(cols.find((c) => c.key === "charity")).toBeUndefined();
  });

  it("keeps a column whose rows are zero but total is non-zero", () => {
    const report = mkReport({
      rows: [mkRow({ year: 2030, charity: 0 })],
      totals: {
        taxesAndExpenses: 0,
        charitableBequests: 0,
        netToHeirs: 0,
        heirsAssets: 0,
        totalToHeirs: 0,
        charity: 99,
      },
    });
    const cols = filterVisibleCols(ALL_COLS, report);
    expect(cols.find((c) => c.key === "charity")).toBeDefined();
  });
});

describe("EstateTransfersYearlyBlock (inner renderer)", () => {
  it("renders year + age + key column cells", () => {
    const report = mkReport({
      rows: [
        mkRow({
          year: 2030,
          ageClient: 65,
          ageSpouse: 61,
          grossEstate: 10_000_000,
          taxesAndExpenses: 1_200_000,
          netToHeirs: 8_800_000,
          totalToHeirs: 9_000_000,
        }),
        mkRow({
          year: 2031,
          ageClient: 66,
          ageSpouse: 62,
          grossEstate: 10_500_000,
          taxesAndExpenses: 1_300_000,
          netToHeirs: 9_200_000,
          totalToHeirs: 9_400_000,
        }),
      ],
      totals: {
        taxesAndExpenses: 2_500_000,
        charitableBequests: 0,
        netToHeirs: 18_000_000,
        heirsAssets: 0,
        totalToHeirs: 18_400_000,
        charity: 0,
      },
    });
    const tree = renderToTree(
      <EstateTransfersYearlyBlock
        report={report}
        ownerNames={ownerNames}
        planLabel={undefined}
        multiPlan={false}
        dotColor="#000"
        compact={false}
      />,
    );
    expect(tree).toContain("2030");
    expect(tree).toContain("65/61");
    expect(tree).toContain("$10,000,000");
    expect(tree).toContain("Gross Estate");
    expect(tree).toContain("Net To Heirs");
  });

  it("renders nested death drill-down rows when deaths.length > 0", () => {
    const report = mkReport({
      rows: [
        mkRow({
          year: 2040,
          ageClient: 75,
          ageSpouse: 71,
          grossEstate: 12_000_000,
          taxesAndExpenses: 2_000_000,
          deaths: [
            mkDeath({
              deathOrder: 1,
              deceased: "client",
              decedentName: "Cooper",
              estateValue: 6_000_000,
              taxableEstate: 5_500_000,
              stateEstateTax: 150_000,
              probateAndExpenses: 30_000,
              estateTaxPayable: 800_000,
              totalTaxAtDeath: 980_000,
            }),
          ],
        }),
      ],
      totals: {
        taxesAndExpenses: 2_000_000,
        charitableBequests: 0,
        netToHeirs: 10_000_000,
        heirsAssets: 0,
        totalToHeirs: 10_000_000,
        charity: 0,
      },
    });
    const tree = renderToTree(
      <EstateTransfersYearlyBlock
        report={report}
        ownerNames={ownerNames}
        planLabel={undefined}
        multiPlan={false}
        dotColor="#000"
        compact={false}
      />,
    );
    expect(tree).toContain("Cooper");
    expect(tree).toContain("1st death");
    expect(tree).toContain("survived by Susan");
    expect(tree).toContain("$800,000");
    expect(tree).toContain("$150,000");
  });

  it("does NOT render drill-down when deaths.length === 0", () => {
    const report = mkReport({
      rows: [
        mkRow({
          year: 2035,
          ageClient: 70,
          ageSpouse: 66,
          grossEstate: 11_000_000,
          deaths: [],
        }),
      ],
      totals: {
        taxesAndExpenses: 0,
        charitableBequests: 0,
        netToHeirs: 11_000_000,
        heirsAssets: 0,
        totalToHeirs: 11_000_000,
        charity: 0,
      },
    });
    const tree = renderToTree(
      <EstateTransfersYearlyBlock
        report={report}
        ownerNames={ownerNames}
        planLabel={undefined}
        multiPlan={false}
        dotColor="#000"
        compact={false}
      />,
    );
    expect(tree).not.toContain("1st death");
    expect(tree).not.toContain("Final death");
    expect(tree).not.toContain("Tax detail by decedent");
  });

  it("filters zero-only columns (Charity) from the header", () => {
    const report = mkReport({
      rows: [
        mkRow({ year: 2030, grossEstate: 1000, charity: 0 }),
        mkRow({ year: 2031, grossEstate: 1500, charity: 0 }),
      ],
      totals: {
        taxesAndExpenses: 0,
        charitableBequests: 0,
        netToHeirs: 0,
        heirsAssets: 0,
        totalToHeirs: 0,
        charity: 0,
      },
    });
    const tree = renderToTree(
      <EstateTransfersYearlyBlock
        report={report}
        ownerNames={ownerNames}
        planLabel={undefined}
        multiPlan={false}
        dotColor="#000"
        compact={false}
      />,
    );
    expect(tree).not.toContain("Charity");
    expect(tree).toContain("Gross Estate");
  });

  it("renders ordering label '<clientName> dies first' for primaryFirst", () => {
    const report = mkReport({
      ordering: "primaryFirst",
      rows: [mkRow({ year: 2030, grossEstate: 1000 })],
    });
    const tree = renderToTree(
      <EstateTransfersYearlyBlock
        report={report}
        ownerNames={ownerNames}
        planLabel={undefined}
        multiPlan={false}
        dotColor="#000"
        compact={false}
      />,
    );
    expect(tree).toContain("Cooper dies first");
  });

  it("renders ordering label '<spouseName> dies first' for spouseFirst", () => {
    const report = mkReport({
      ordering: "spouseFirst",
      rows: [mkRow({ year: 2030, grossEstate: 1000 })],
    });
    const tree = renderToTree(
      <EstateTransfersYearlyBlock
        report={report}
        ownerNames={ownerNames}
        planLabel={undefined}
        multiPlan={false}
        dotColor="#000"
        compact={false}
      />,
    );
    expect(tree).toContain("Susan dies first");
  });

  it("renders Total row with summed values", () => {
    const report = mkReport({
      rows: [
        mkRow({
          year: 2030,
          grossEstate: 1000,
          taxesAndExpenses: 100,
          netToHeirs: 900,
          totalToHeirs: 900,
        }),
        mkRow({
          year: 2031,
          grossEstate: 1500,
          taxesAndExpenses: 200,
          netToHeirs: 1300,
          totalToHeirs: 1300,
        }),
      ],
      totals: {
        taxesAndExpenses: 300,
        charitableBequests: 0,
        netToHeirs: 2200,
        heirsAssets: 0,
        totalToHeirs: 2200,
        charity: 0,
      },
    });
    const tree = renderToTree(
      <EstateTransfersYearlyBlock
        report={report}
        ownerNames={ownerNames}
        planLabel={undefined}
        multiPlan={false}
        dotColor="#000"
        compact={false}
      />,
    );
    expect(tree).toContain("Total");
    expect(tree).toContain("$300");
    expect(tree).toContain("$2,200");
  });

  it("renders empty state when report.rows is empty", () => {
    const report = mkReport({ rows: [] });
    const tree = renderToTree(
      <EstateTransfersYearlyBlock
        report={report}
        ownerNames={ownerNames}
        planLabel={undefined}
        multiPlan={false}
        dotColor="#000"
        compact={false}
      />,
    );
    expect(tree).toContain("No yearly estate data available.");
  });
});

describe("EstateTransfersYearlyPdf (outer wrapper)", () => {
  it("renders empty state via the real pipeline when projection.years is empty", () => {
    const plan = mkPlan();
    const tree = renderToTree(
      <EstateTransfersYearlyPdf
        config={undefined}
        plans={[plan]}
        mc={null}
        yearRange={null}
        span={5}
        branding={branding}
      />,
    );
    expect(tree).toContain("No yearly estate data available.");
  });

  it("suppresses plan labels when only one plan is present", () => {
    const plan = mkPlan({ label: "Plan-Alpha" });
    const tree = renderToTree(
      <EstateTransfersYearlyPdf
        config={undefined}
        plans={[plan]}
        mc={null}
        yearRange={null}
        span={5}
        branding={branding}
      />,
    );
    expect(tree).not.toContain("Plan-Alpha");
  });

  it("shows plan labels when more than one plan is present", () => {
    const a = mkPlan({ id: "a", label: "Plan-Alpha" });
    const b = mkPlan({ id: "b", label: "Plan-Beta" });
    const tree = renderToTree(
      <EstateTransfersYearlyPdf
        config={undefined}
        plans={[a, b]}
        mc={null}
        yearRange={null}
        span={5}
        branding={branding}
      />,
    );
    expect(tree).toContain("Plan-Alpha");
    expect(tree).toContain("Plan-Beta");
  });
});
