// The deck's Contents numbers every page after this one from
// `estimateBalanceSheetReportPageCount`, which runs before react-pdf lays
// anything out. Wrong, the sheet still prints — its own footer is right — and
// the Contents quietly sends the reader to the wrong page. So this renders the
// real page and counts the sheets react-pdf produced, on both sides of every
// break the layout has.
import { describe, it, expect } from "vitest";
import { Document, renderToBuffer } from "@react-pdf/renderer";
import { ensureFontsRegistered } from "../../../shared/fonts";
import { renderedPages } from "@/components/presentations/shared/test-utils/pdf-bbox";
import { SECTION_ACCENTS } from "@/lib/presentations/theme";
import { estimateBalanceSheetReportPageCount } from "@/lib/presentations/pages/balance-sheet-report/estimate-page-count";
import type { BalanceSheetReportPageData } from "@/lib/presentations/pages/balance-sheet-report/view-model";
import type { BalanceSheetPdfView } from "@/components/balance-sheet-report-pdf/balance-sheet-pdf-document";
import type { OwnerColumnRow } from "@/components/balance-sheet-report/household-columns";
import type { EntityGroup } from "@/components/balance-sheet-report/view-model";
import type { TrustDetails } from "@/lib/balance-sheet/trust-details";
import { CATEGORY_LABELS, CATEGORY_ORDER } from "@/components/balance-sheet-report/tokens";
import { BalanceSheetReportPagePdf } from "../page-pdf";

ensureFontsRegistered();

const cols = (v: number) => ({ client: v, spouse: v, joint: v, total: 3 * v });

function row(key: string, name: string, over: Partial<OwnerColumnRow> = {}): OwnerColumnRow {
  return { key, name, hasLinkedMortgage: false, ...cols(1_234_567), ...over };
}

/** A household with `accounts` spread over four categories. */
function household(
  accounts: number,
  over: { liabilities?: number; spouse?: boolean; outOfEstate?: number; slices?: number; row?: Partial<OwnerColumnRow> } = {},
): BalanceSheetPdfView {
  const { liabilities = 2, spouse = true, outOfEstate = 0, slices = 4 } = over;
  return {
    kind: "household",
    household: {
      selectedYear: 2026,
      hasSpouse: spouse,
      assetCategories: CATEGORY_ORDER.slice(0, 4).map((key, c) => ({
        key,
        label: CATEGORY_LABELS[key],
        ...cols(1_234_567),
        rows: Array.from({ length: Math.floor(accounts / 4) + (c < accounts % 4 ? 1 : 0) }, (_, i) =>
          row(`${c}-${i}`, `${CATEGORY_LABELS[key]} account ${i + 1}`, over.row),
        ),
      })).filter((cat) => cat.rows.length > 0),
      liabilityRows: Array.from({ length: liabilities }, (_, i) => row(`l${i}`, `Loan ${i + 1}`)),
      totalAssets: cols(9_999_999),
      totalLiabilities: cols(100_000),
      netWorth: cols(9_000_000),
    },
    donut: CATEGORY_ORDER.slice(0, slices).map((key) => ({ key, label: CATEGORY_LABELS[key], value: 10, hex: "#2d61aa" })),
    outOfEstate: {
      selectedYear: 2026,
      outOfEstateNetWorth: 500_000,
      outOfEstateOwnerRows: Array.from({ length: outOfEstate }, (_, i) => ({
        ownerKey: `en:${i}`, ownerName: `Trust ${i + 1}`, ownerType: "trust", assetTotal: 500_000, liabilityTotal: 0, net: 500_000,
      })),
    },
    clientLabel: "John",
    spouseLabel: spouse ? "Jane" : null,
  };
}

const TRUST_DETAILS = (entityId: string): TrustDetails => ({
  entityId,
  subTypeLabel: "ILIT",
  trustee: "First National Trust Company",
  grantor: "John",
  powers: ["Crummey", "Swap power"],
  beneficiaries: [
    { group: "Primary", name: "Children's Trust", percentage: 100 },
    { group: "Contingent", name: "Grandchildren", percentage: 100 },
  ] as TrustDetails["beneficiaries"],
});

/** `count` trusts and businesses, each holding `accounts` accounts. */
function entities(count: number, accounts: number): BalanceSheetPdfView {
  const groups = Array.from({ length: count }, (_, i): EntityGroup => ({
    entityId: `e${i}`,
    entityName: `Entity ${i + 1}`,
    entityType: i % 2 === 0 ? "trust" : "llc",
    assetRows: Array.from({ length: accounts }, (_, a) => ({
      rowKey: `${i}-${a}`,
      accountName: `Account ${a + 1}`,
      value: 250_000,
    })) as EntityGroup["assetRows"],
    assetTotal: accounts * 250_000,
    liabilityRows: [],
    liabilityTotal: 0,
    netWorth: accounts * 250_000,
  }));
  return { kind: "entities", groups, trustDetails: groups.filter((_, i) => i % 2 === 0).map((g) => TRUST_DETAILS(g.entityId)) };
}

const sheet = (view: BalanceSheetPdfView): BalanceSheetReportPageData => ({
  subtitle: "Household · Today (2026) · Ages 64 & 62",
  view,
});
const estimate = (view: BalanceSheetPdfView) => estimateBalanceSheetReportPageCount(sheet(view));

async function renderedSheets(view: BalanceSheetPdfView): Promise<number> {
  const buf = await renderToBuffer(
    <Document>
      {BalanceSheetReportPagePdf({
        data: sheet(view),
        firmName: "Ethos Financial Group",
        clientName: "John & Jane",
        reportDate: "October 26, 2026",
        pageIndex: 1,
        totalPages: 1,
        accent: SECTION_ACCENTS.Assets,
      })}
    </Document>,
  );
  return renderedPages(buf);
}

async function expectAgrees(view: BalanceSheetPdfView, label: string): Promise<number> {
  const actual = await renderedSheets(view);
  const estimated = estimate(view);
  expect(estimated, `${label}: estimated ${estimated}, rendered ${actual}`).toBe(actual);
  return actual;
}

/** Renders both sides of every break the estimate puts in the first `upTo`
 *  sizes — the sizes where an estimate that is merely close goes wrong — and
 *  requires the renders to cross at least `minBreaks` breaks of their own, so
 *  a sweep can never quietly stop straddling one. */
async function acrossBreaks(make: (n: number) => BalanceSheetPdfView, label: string, upTo: number, minBreaks = 1) {
  const sizes = new Set<number>();
  for (let n = 2; n <= upTo; n++) {
    if (estimate(make(n)) !== estimate(make(n - 1))) [n - 2, n - 1, n, n + 1].filter((m) => m >= 0).forEach((m) => sizes.add(m));
  }
  const rendered = new Set<number>();
  for (const n of sizes) rendered.add(await expectAgrees(make(n), `${label}, ${n}`));
  expect(rendered.size, `${label}: the sweep crossed no break`).toBeGreaterThan(minBreaks);
}

describe("estimateBalanceSheetReportPageCount matches the sheets react-pdf renders", () => {
  it("a couple's household, across the first and second breaks", async () => {
    await acrossBreaks((n) => household(n), "couple, accounts", 60, 2);
  }, 120_000);

  it("a single client's household, whose names get the width the spouse columns left", async () => {
    await acrossBreaks((n) => household(n, { spouse: false }), "single, accounts", 30);
  }, 60_000);

  it("the Out of Estate table, which moves whole to the next sheet", async () => {
    await acrossBreaks((n) => household(4, { outOfEstate: n }), "Out of Estate rows beside 4 accounts", 12);
    await acrossBreaks((n) => household(n, { outOfEstate: 3 }), "accounts + 3 Out of Estate rows", 30);
  }, 60_000);

  it("margin-loan lines and long names that wrap", async () => {
    await acrossBreaks((n) => household(n, { row: { marginLoan: 40_000 } }), "accounts with margin loans", 30);
    await acrossBreaks(
      (n) => household(n, { row: { revocableTrustName: "The John and Jane Smith Revocable Living Trust" } }),
      "accounts in a revocable trust",
      30,
    );
  }, 120_000);

  it("a legend longer than the pie", async () => {
    await acrossBreaks((n) => household(n, { slices: 8 }), "accounts beside 8 slices", 30);
  }, 60_000);

  it("by entity: each trust or business moves whole to the next sheet", async () => {
    await acrossBreaks((n) => entities(n, 3), "entities × 3 accounts", 12, 2);
    await acrossBreaks((n) => entities(3, n), "3 entities × accounts", 20);
    await expectAgrees(entities(0, 0), "no entities");
  }, 120_000);

  it("answers 1 for the registry's data-free probe", () => {
    expect(estimateBalanceSheetReportPageCount()).toBe(1);
  });
});
