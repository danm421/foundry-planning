import { describe, expect, it } from "vitest";
import { renderToTree } from "@/components/pdf/test-utils/render-tree";
import {
  MajorTransactionsPdf,
  MajorTransactionsBlock,
  buildTransactionRows,
  type TransactionRow,
} from "../major-transactions";
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";

const branding = { primaryColor: "#000", firmName: "x", logoDataUrl: null };

interface SaleFixture {
  transactionId: string;
  name: string;
  saleValue: number;
  transactionCosts: number;
  mortgagePaidOff: number;
  netProceeds: number;
  capitalGain: number;
}

interface PurchaseFixture {
  transactionId: string;
  name: string;
  purchasePrice: number;
  mortgageAmount: number;
  equity: number;
}

interface YearFixture {
  year: number;
  sales?: SaleFixture[];
  purchases?: PurchaseFixture[];
}

function mkYear(args: YearFixture) {
  return {
    year: args.year,
    techniqueBreakdown: {
      sales: args.sales ?? [],
      purchases: args.purchases ?? [],
    },
  } as unknown as import("@/engine").ProjectionYear;
}

function mkSale(name: string, netProceeds: number, year: number, idx = 0): SaleFixture {
  return {
    transactionId: `sale-${year}-${idx}`,
    name,
    saleValue: netProceeds + 5_000,
    transactionCosts: 1_000,
    mortgagePaidOff: 0,
    netProceeds,
    capitalGain: Math.round(netProceeds * 0.4),
  };
}

function mkPurchase(name: string, price: number, year: number, idx = 0): PurchaseFixture {
  return {
    transactionId: `purchase-${year}-${idx}`,
    name,
    purchasePrice: price,
    mortgageAmount: 0,
    equity: price,
  };
}

interface MakePlanArgs {
  id?: string;
  label?: string;
  years?: ReturnType<typeof mkYear>[];
}

function mkPlan(args: MakePlanArgs = {}): ComparisonPlan {
  return {
    id: args.id ?? "p1",
    label: args.label ?? "A",
    tree: {
      client: { firstName: "Avery", dateOfBirth: "1975-06-20", filingStatus: "single" },
      familyMembers: [],
    },
    result: {
      years: args.years ?? [],
    },
  } as unknown as ComparisonPlan;
}

// ─── Pure helper tests ──────────────────────────────────────────────────────

describe("buildTransactionRows", () => {
  it("returns one row per sale (multiple sales same year)", () => {
    const plan = mkPlan({
      years: [
        mkYear({
          year: 2030,
          sales: [mkSale("Beach house", 500_000, 2030, 0), mkSale("Boat", 50_000, 2030, 1)],
        }),
      ],
    });
    const rows = buildTransactionRows(plan, null);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ year: 2030, description: "Beach house", inflow: 500_000, outflow: 0 });
    expect(rows[1]).toMatchObject({ year: 2030, description: "Boat", inflow: 50_000, outflow: 0 });
  });

  it("returns one row per purchase", () => {
    const plan = mkPlan({
      years: [
        mkYear({
          year: 2031,
          purchases: [mkPurchase("Lake house", 750_000, 2031)],
        }),
      ],
    });
    const rows = buildTransactionRows(plan, null);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ year: 2031, description: "Lake house", inflow: 0, outflow: 750_000 });
  });

  it("drops years with empty sales AND empty purchases", () => {
    const plan = mkPlan({
      years: [
        mkYear({ year: 2030, sales: [mkSale("Boat", 50_000, 2030)] }),
        mkYear({ year: 2031 }), // inactive
        mkYear({ year: 2032, purchases: [mkPurchase("House", 600_000, 2032)] }),
      ],
    });
    const rows = buildTransactionRows(plan, null);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.year)).toEqual([2030, 2032]);
  });

  it("applies yearRange clipping", () => {
    const plan = mkPlan({
      years: [
        mkYear({ year: 2025, sales: [mkSale("Asset A", 10_000, 2025)] }),
        mkYear({ year: 2030, sales: [mkSale("Asset B", 20_000, 2030)] }),
        mkYear({ year: 2035, sales: [mkSale("Asset C", 30_000, 2035)] }),
      ],
    });
    const rows = buildTransactionRows(plan, { start: 2028, end: 2032 });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ year: 2030, description: "Asset B" });
  });

  it("sorts year ascending, sales before purchases within year", () => {
    const plan = mkPlan({
      years: [
        // Disorder year + intra-year: purchase appears before sale in source
        mkYear({
          year: 2032,
          purchases: [mkPurchase("Cabin", 400_000, 2032)],
          sales: [mkSale("Coin collection", 100_000, 2032)],
        }),
        mkYear({ year: 2030, sales: [mkSale("Painting", 25_000, 2030)] }),
      ],
    });
    const rows = buildTransactionRows(plan, null);
    expect(rows.map((r) => ({ year: r.year, description: r.description }))).toEqual([
      { year: 2030, description: "Painting" },
      { year: 2032, description: "Coin collection" },
      { year: 2032, description: "Cabin" },
    ]);
  });
});

// ─── Inner component tests (canned rows) ────────────────────────────────────

describe("MajorTransactionsBlock", () => {
  it("renders headers and sample row data", () => {
    const rows: TransactionRow[] = [
      { year: 2030, description: "Boat sale", inflow: 50_000, outflow: 0 },
    ];
    const tree = renderToTree(
      <MajorTransactionsBlock
        rows={rows}
        planLabel="A"
        multiPlan={false}
        dotColor="#000"
        compact={false}
      />,
    );
    expect(tree).toContain("Year");
    expect(tree).toContain("Description");
    expect(tree).toContain("Inflow");
    expect(tree).toContain("Outflow");
    expect(tree).toContain("2030");
    expect(tree).toContain("Boat sale");
    expect(tree).toContain("$50,000");
  });

  it("renders em-dash for zero inflow/outflow", () => {
    const rows: TransactionRow[] = [
      { year: 2030, description: "Boat sale", inflow: 50_000, outflow: 0 },
    ];
    const tree = renderToTree(
      <MajorTransactionsBlock
        rows={rows}
        planLabel="A"
        multiPlan={false}
        dotColor="#000"
        compact={false}
      />,
    );
    expect(tree).toContain("—");
  });

  it("renders Total row summing inflow and outflow", () => {
    const rows: TransactionRow[] = [
      { year: 2030, description: "Asset A", inflow: 50_000, outflow: 0 },
      { year: 2031, description: "Asset B", inflow: 30_000, outflow: 0 },
    ];
    const tree = renderToTree(
      <MajorTransactionsBlock
        rows={rows}
        planLabel="A"
        multiPlan={false}
        dotColor="#000"
        compact={false}
      />,
    );
    expect(tree).toContain("Total");
    expect(tree).toContain("$80,000");
  });

  it("renders empty state when rows.length === 0", () => {
    const tree = renderToTree(
      <MajorTransactionsBlock
        rows={[]}
        planLabel="A"
        multiPlan={false}
        dotColor="#000"
        compact={false}
      />,
    );
    expect(tree).toContain("No major transactions in selected range.");
  });
});

// ─── Outer-component smoke tests ────────────────────────────────────────────

describe("MajorTransactionsPdf", () => {
  it("shows plan labels for multi-plan and suppresses them for single-plan", () => {
    const planA = mkPlan({ id: "A", label: "Plan Alpha" });
    const planB = mkPlan({ id: "B", label: "Plan Beta" });

    const multi = renderToTree(
      <MajorTransactionsPdf
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
      <MajorTransactionsPdf
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

  it("filters out non-active years end-to-end", () => {
    const plan = mkPlan({
      years: [
        mkYear({ year: 2030, sales: [mkSale("Beach house", 500_000, 2030)] }),
        mkYear({ year: 2031 }), // inactive — should not appear
      ],
    });
    const tree = renderToTree(
      <MajorTransactionsPdf
        config={undefined}
        plans={[plan]}
        mc={null}
        yearRange={null}
        span={5}
        branding={branding}
      />,
    );
    expect(tree).toContain("Beach house");
    expect(tree).toContain("2030");
    expect(tree).not.toContain("2031");
  });
});
