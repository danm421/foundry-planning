import { describe, it, expect, vi, afterEach } from "vitest";
import { renderToBuffer } from "@react-pdf/renderer";
import { BalanceSheetPdfDocument } from "../balance-sheet-pdf-document";
import type {
  AssetRow,
  LiabilityRow,
  BalanceSheetViewModel,
} from "../../balance-sheet-report/view-model";

function mkAsset(args: Partial<AssetRow> & { rowKey: string; accountId: string; value: number }): AssetRow {
  return {
    rowKey: args.rowKey,
    accountId: args.accountId,
    accountName: args.accountName ?? "Joint Brokerage",
    owner: args.owner ?? null,
    ownerEntityId: args.ownerEntityId ?? null,
    ownerPercent: args.ownerPercent ?? 1,
    ownerLabel: args.ownerLabel ?? "Client",
    value: args.value,
    hasLinkedMortgage: args.hasLinkedMortgage ?? false,
    isFlatBusinessValue: args.isFlatBusinessValue ?? false,
    accountHasMultipleOwners: args.accountHasMultipleOwners ?? true,
  };
}

function mkLiability(args: Partial<LiabilityRow> & { rowKey: string; liabilityId: string; balance: number }): LiabilityRow {
  return {
    rowKey: args.rowKey,
    liabilityId: args.liabilityId,
    liabilityName: args.liabilityName ?? "Joint Mortgage",
    owner: args.owner ?? null,
    ownerEntityId: args.ownerEntityId ?? null,
    ownerPercent: args.ownerPercent ?? 1,
    ownerLabel: args.ownerLabel ?? "Client",
    balance: args.balance,
  };
}

// A multi-owner brokerage (client 60% / spouse 40%) produces two AssetRows with
// the SAME accountId but distinct rowKeys; likewise for an out-of-estate account
// and a jointly-held mortgage. The PDF must key off rowKey, not accountId /
// liabilityId, or React's reconciler warns about (and can drop) the duplicate-
// keyed siblings (F78).
function multiOwnerViewModel(): BalanceSheetViewModel {
  return {
    selectedYear: 2026,
    assetCategories: [
      {
        key: "taxable",
        label: "Taxable",
        total: 1_000_000,
        yoy: null,
        rows: [
          mkAsset({ rowKey: "acct1#client", accountId: "acct1", value: 600_000, ownerLabel: "Client" }),
          mkAsset({ rowKey: "acct1#spouse", accountId: "acct1", value: 400_000, ownerLabel: "Spouse" }),
        ],
      },
    ],
    outOfEstateRows: [
      mkAsset({ rowKey: "ooe1#fmA", accountId: "ooe1", accountName: "Family Trust Acct", value: 300_000 }),
      mkAsset({ rowKey: "ooe1#fmB", accountId: "ooe1", accountName: "Family Trust Acct", value: 200_000 }),
    ],
    outOfEstateLiabilityRows: [],
    outOfEstateNetWorth: 500_000,
    liabilityRows: [
      mkLiability({ rowKey: "liab1#client", liabilityId: "liab1", balance: 150_000 }),
      mkLiability({ rowKey: "liab1#spouse", liabilityId: "liab1", balance: 100_000 }),
    ],
    totalAssets: 1_000_000,
    totalLiabilities: 250_000,
    netWorth: 750_000,
    realEstateEquity: 0,
    donut: [],
    barChartSeries: [],
    yoy: { totalAssets: null, totalLiabilities: null, netWorth: null },
  };
}

const docProps = {
  clientName: "Cooper",
  asOfLabel: "2026",
  viewLabel: "Consolidated",
  generatedAt: "2026-06-01",
  donutPng: null,
  barPng: null,
};

describe("BalanceSheetPdfDocument — multi-owner row keys (F78)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("renders without a React duplicate-key warning for multi-owner accounts", async () => {
    const calls: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...a) => {
      calls.push(String(a[0]));
    });
    const buf = await renderToBuffer(
      <BalanceSheetPdfDocument {...docProps} viewModel={multiOwnerViewModel()} />,
    );
    spy.mockRestore();
    expect(buf.length).toBeGreaterThan(0);
    const dupKeyWarning = calls.find((c) => c.includes("same key"));
    expect(dupKeyWarning).toBeUndefined();
  });
});
