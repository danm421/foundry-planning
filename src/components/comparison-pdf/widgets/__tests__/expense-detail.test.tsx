import { describe, expect, it } from "vitest";
import { renderToTree } from "@/components/pdf/test-utils/render-tree";
import { ExpenseDetailPdf } from "../expense-detail";
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";

const branding = { primaryColor: "#000", firmName: "x", logoDataUrl: null };

interface ExpenseFixture {
  id: string;
  type: "living" | "other" | "insurance";
  name: string;
  annualAmount: number;
  startYear: number;
  endYear: number;
}

interface YearFixture {
  year: number;
  expenses: { bySource: Record<string, number> };
}

interface MakePlanArgs {
  id?: string;
  label?: string;
  expenses?: ExpenseFixture[];
  years?: YearFixture[];
  client?: {
    dateOfBirth?: string;
    retirementAge?: number;
    spouseDob?: string;
    spouseRetirementAge?: number;
  };
}

function mkPlan(args: MakePlanArgs = {}): ComparisonPlan {
  return {
    id: args.id ?? "p1",
    label: args.label ?? "A",
    tree: {
      client: args.client ?? {
        dateOfBirth: "1975-06-20",
        retirementAge: 65,
        spouseDob: "1979-01-01",
        spouseRetirementAge: 61,
      },
      expenses: args.expenses ?? [],
    },
    result: {
      years: args.years ?? [],
    },
  } as unknown as ComparisonPlan;
}

const defaultLiving: ExpenseFixture[] = [
  {
    id: "e1",
    type: "living",
    name: "Household",
    annualAmount: 55_000,
    startYear: 2025,
    endYear: 2080,
  },
  {
    id: "e2",
    type: "living",
    name: "Travel",
    annualAmount: 12_000,
    startYear: 2025,
    endYear: 2080,
  },
];

// Today's year (2026) is in this range, and retY = 1975+65 = 2040.
const defaultYears: YearFixture[] = [
  { year: 2026, expenses: { bySource: { e1: 55_000, e2: 12_000 } } },
  { year: 2040, expenses: { bySource: { e1: 70_000, e2: 40_000 } } },
];

describe("ExpenseDetailPdf", () => {
  it("renders one row per living expense plus a Total Living Expenses row", () => {
    const plan = mkPlan({
      expenses: defaultLiving,
      years: defaultYears,
    });
    const tree = renderToTree(
      <ExpenseDetailPdf
        config={undefined}
        plans={[plan]}
        mc={null}
        yearRange={null}
        span={5}
        branding={branding}
      />,
    );
    expect(tree).toContain("Household");
    expect(tree).toContain("Travel");
    expect(tree).toContain("Total Living Expenses");
    // 55,000 + 12,000 = 67,000 for the Current (2026) column.
    expect(tree).toContain("$67,000");
  });

  it("renders Current and Retirement column headers with the right years", () => {
    const plan = mkPlan({
      expenses: defaultLiving,
      years: defaultYears,
    });
    const tree = renderToTree(
      <ExpenseDetailPdf
        config={undefined}
        plans={[plan]}
        mc={null}
        yearRange={null}
        span={5}
        branding={branding}
      />,
    );
    expect(tree).toContain("Current (2026)");
    expect(tree).toContain("Retirement (2040)");
  });

  it("renders the events table only when events exist", () => {
    const planWithEvent = mkPlan({
      expenses: [
        ...defaultLiving,
        {
          id: "e3",
          type: "other",
          name: "College for Child",
          annualAmount: 39_000,
          startYear: 2033,
          endYear: 2036,
        },
      ],
      years: defaultYears,
    });
    const tree = renderToTree(
      <ExpenseDetailPdf
        config={undefined}
        plans={[planWithEvent]}
        mc={null}
        yearRange={null}
        span={5}
        branding={branding}
      />,
    );
    expect(tree).toContain("College for Child");
    // en-dash between years.
    expect(tree).toContain("2033–2036");
    expect(tree).toContain("Year(s)");

    const planNoEvents = mkPlan({
      expenses: defaultLiving,
      years: defaultYears,
    });
    const treeNoEvents = renderToTree(
      <ExpenseDetailPdf
        config={undefined}
        plans={[planNoEvents]}
        mc={null}
        yearRange={null}
        span={5}
        branding={branding}
      />,
    );
    expect(treeNoEvents).not.toContain("College for Child");
    expect(treeNoEvents).not.toContain("Year(s)");
  });

  it("filters out events that span 50+ years (treated as lifetime expenses)", () => {
    const plan = mkPlan({
      expenses: [
        ...defaultLiving,
        {
          id: "e-lifetime",
          type: "other",
          name: "Lifetime Other",
          annualAmount: 1_000,
          startYear: 2025,
          endYear: 2080, // 55-year span
        },
      ],
      years: defaultYears,
    });
    const tree = renderToTree(
      <ExpenseDetailPdf
        config={undefined}
        plans={[plan]}
        mc={null}
        yearRange={null}
        span={5}
        branding={branding}
      />,
    );
    expect(tree).not.toContain("Lifetime Other");
    expect(tree).not.toContain("Year(s)");
  });

  it("shows plan labels for multi-plan and suppresses them for single-plan", () => {
    const planA = mkPlan({
      id: "A",
      label: "Plan Alpha",
      expenses: defaultLiving,
      years: defaultYears,
    });
    const planB = mkPlan({
      id: "B",
      label: "Plan Beta",
      expenses: defaultLiving,
      years: defaultYears,
    });

    const multi = renderToTree(
      <ExpenseDetailPdf
        config={undefined}
        plans={[planA, planB]}
        mc={null}
        yearRange={null}
        span={5}
        branding={branding}
      />,
    );
    expect(multi).toContain("Plan Alpha");
    expect(multi).toContain("Plan Beta");

    const single = renderToTree(
      <ExpenseDetailPdf
        config={undefined}
        plans={[planA]}
        mc={null}
        yearRange={null}
        span={5}
        branding={branding}
      />,
    );
    expect(single).not.toContain("Plan Alpha");
  });
});
