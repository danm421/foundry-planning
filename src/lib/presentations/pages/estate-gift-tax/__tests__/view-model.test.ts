import { describe, it, expect } from "vitest";
import type { GiftLedgerYear } from "@/engine/gift-ledger";
import { makeClientData } from "@/lib/presentations/pages/cash-flow/__tests__/fixtures";
import { buildGiftTaxDrillData } from "../view-model";

function grantor(over: Partial<GiftLedgerYear["perGrantor"]["client"]> = {}) {
  return {
    taxableGiftsThisYear: 0, cumulativeTaxableGifts: 50_000, creditUsed: 10_600,
    giftTaxThisYear: 0, cumulativeGiftTax: 0, ...over,
  };
}

const giftLedger: GiftLedgerYear[] = [
  {
    year: 2026, giftsGiven: 50_000, fullValueTransferred: 50_000, taxableGiftsGiven: 50_000,
    perGrantor: { client: grantor(), spouse: grantor() }, totalGiftTax: 0,
  },
];

function baseInput(over: { spouseName?: string | null; giftLedger?: GiftLedgerYear[] } = {}) {
  return {
    projection: {
      years: [{ year: 2026 }],
      giftLedger: over.giftLedger ?? giftLedger,
      firstDeathEvent: { deceased: "client" },
    } as never,
    clientData: makeClientData(),
    scenarioLabel: "Base Case",
    clientName: "Cooper",
    spouseName: "spouseName" in over ? over.spouseName! : ("Susan" as string | null),
    options: { range: "full" as const, showCallout: false },
  };
}

describe("buildGiftTaxDrillData", () => {
  it("maps gift columns with per-Co-client groups and total pinned, no chart", () => {
    const d = buildGiftTaxDrillData(baseInput());
    expect(d.title).toBe("Gift Tax");
    expect(d.chartSpec).toBeUndefined();
    const r = d.table.rows.find((row) => row.year === 2026)!;
    expect(r.cells.giftsGiven).toBe(50_000);
    expect(r.cells.clientCumulGifts).toBe(50_000);
    expect(r.cells.spouseCreditUsed).toBe(10_600);
    expect(r.cells.giftTax).toBe(0);
    const last = d.table.columns.at(-1)!;
    expect(last.key).toBe("giftTax");
    expect(last.strong).toBe(true);
  });

  it("uses real first names in the per-Co-client headers", () => {
    const d = buildGiftTaxDrillData(baseInput());
    const headers = d.table.columns.map((c) => c.header);
    expect(headers.some((h) => h.includes("Cooper"))).toBe(true);
    expect(headers.some((h) => h.includes("Susan"))).toBe(true);
  });

  it("omits the Co-client column group when there is no Co-client", () => {
    const noSpouseLedger: GiftLedgerYear[] = [
      { year: 2026, giftsGiven: 50_000, fullValueTransferred: 50_000, taxableGiftsGiven: 50_000,
        perGrantor: { client: grantor() }, totalGiftTax: 0 },
    ];
    const d = buildGiftTaxDrillData(baseInput({ spouseName: null, giftLedger: noSpouseLedger }));
    const keys = d.table.columns.map((c) => c.key);
    expect(keys).not.toContain("spouseCumulGifts");
    expect(keys).toContain("clientCumulGifts");
  });
});

describe("buildGiftTaxDrillData — Full Value Transferred column", () => {
  const discountedLedger: GiftLedgerYear[] = [
    {
      year: 2026, giftsGiven: 700_000, fullValueTransferred: 1_000_000,
      taxableGiftsGiven: 700_000,
      perGrantor: { client: grantor(), spouse: grantor() }, totalGiftTax: 0,
    },
  ];

  it("renders Full Value Transferred immediately before Gifts Given", () => {
    const d = buildGiftTaxDrillData(baseInput({ giftLedger: discountedLedger }));
    const keys = d.table.columns.map((c) => c.key);
    // Guard the index comparison: absent from both sides it reads -1 === -1.
    expect(keys).toContain("fullValueTransferred");
    expect(keys.indexOf("fullValueTransferred")).toBe(keys.indexOf("giftsGiven") - 1);
  });

  it("carries the full value and the discounted value as separate cells", () => {
    const d = buildGiftTaxDrillData(baseInput({ giftLedger: discountedLedger }));
    const r = d.table.rows.find((row) => row.year === 2026)!;
    expect(r.cells.fullValueTransferred).toBe(1_000_000);
    expect(r.cells.giftsGiven).toBe(700_000);
  });

  it("keeps the total column pinned last after the new column is added", () => {
    const d = buildGiftTaxDrillData(baseInput({ giftLedger: discountedLedger }));
    const last = d.table.columns.at(-1)!;
    expect(last.key).toBe("giftTax");
    expect(last.strong).toBe(true);
  });
});
