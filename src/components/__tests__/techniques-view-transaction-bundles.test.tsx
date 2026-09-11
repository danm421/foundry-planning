// @vitest-environment jsdom
/**
 * The Details → Techniques surface must hand the asset-transaction dialog the
 * SIBLING SET of the record being edited, always. The dialog only mints a
 * shared bundle id when its caller proved it knows the record's siblings
 * (`bundleRecords`); a caller that omits them and then grows the transaction
 * produces two records with derived "X — Sell / X — Buy" names and a NULL
 * bundle_id, which the Solver renders as two unrelated technique rows — the
 * exact defect this feature removes.
 *
 * The assertions are on what the dialog RECEIVES, not on component state.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { AssetTransactionRow } from "@/components/techniques-view";
import type { AssetTransactionInitialData } from "@/components/forms/add-asset-transaction-form";

// ---------------------------------------------------------------------------
// Mocks — declared before any module imports
// ---------------------------------------------------------------------------

type DialogProps = {
  bundleRecords?: { id: string; bundleId: string | null }[];
  initialData?: AssetTransactionInitialData;
};

const { dialogProps } = vi.hoisted(() => ({
  dialogProps: [] as DialogProps[],
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => ({ get: vi.fn(() => null), toString: () => "" }),
  usePathname: () => "/clients/c-1/details/techniques",
}));

vi.mock("@/hooks/use-scenario-writer", () => ({
  useScenarioWriter: () => ({ submit: vi.fn() }),
}));

vi.mock("@/hooks/use-scenario-state", () => ({
  useScenarioState: () => ({ scenarioId: null }),
}));

vi.mock("@/components/forms/add-transfer-form", () => ({ default: () => null }));
vi.mock("@/components/forms/add-reinvestment-form", () => ({ default: () => null }));
vi.mock("@/components/forms/add-relocation-form", () => ({ default: () => null }));
vi.mock("@/components/forms/add-roth-conversion-form", () => ({ default: () => null }));
vi.mock("@/components/help-tip", () => ({ HelpTip: () => null }));

// The dialog under observation: records the props it was mounted with.
vi.mock("@/components/forms/add-asset-transaction-form", () => ({
  default: (props: DialogProps) => {
    dialogProps.push(props);
    return null;
  },
}));

vi.mock("@/engine", () => ({ runProjection: () => [] }));
vi.mock("@/lib/solver/technique-summaries", () => ({
  formatReinvestmentScope: (g: number, a: number) => `${g}g ${a}a`,
}));
vi.mock("@/lib/milestones", () => ({ YEAR_REF_LABELS: {} }));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { ClientAccessProvider } from "@/components/client-access-provider";
import TechniquesView from "@/components/techniques-view";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BUNDLE_A = "00000000-0000-4000-8000-00000000000a";
const BUNDLE_B = "00000000-0000-4000-8000-00000000000b";

function txn(over: Partial<AssetTransactionRow> & { id: string; name: string }): AssetTransactionRow {
  return {
    type: "sell",
    year: 2027,
    accountId: "acc-1",
    purchaseTransactionId: null,
    businessAccountId: null,
    bundleId: null,
    fractionSold: null,
    overrideSaleValue: null,
    overrideBasis: null,
    transactionCostPct: null,
    transactionCostFlat: null,
    proceedsAccountId: null,
    qualifiesForHomeSaleExclusion: null,
    assetName: null,
    assetCategory: null,
    assetSubType: null,
    purchasePrice: null,
    growthRate: null,
    basis: null,
    fundingAccountId: null,
    mortgageAmount: null,
    mortgageRate: null,
    mortgageTermMonths: null,
    annualPropertyTax: null,
    propertyTaxGrowthRate: null,
    propertyTaxGrowthSource: null,
    ...over,
  };
}

/** Two legs of one bundle, one leg of another, and one solo/legacy record. */
const ROWS: AssetTransactionRow[] = [
  txn({ id: "a-sell", name: "Move house — Sell Oak", bundleId: BUNDLE_A }),
  txn({ id: "a-buy", name: "Move house — Buy Condo", type: "buy", bundleId: BUNDLE_A, assetName: "Condo", purchasePrice: "800000" }),
  txn({ id: "b-sell", name: "Downsize — Sell Cabin", bundleId: BUNDLE_B }),
  txn({ id: "solo", name: "Sell Boat" }),
];

function renderWithRows(rows: AssetTransactionRow[]) {
  return render(
    <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
      <TechniquesView
        clientId="c-1"
        transfers={[]}
        reinvestments={[]}
        relocations={[]}
        assetTransactions={rows}
        rothConversions={[]}
        accounts={[{ id: "acc-1", name: "Oak Ave", category: "real_estate", subType: "primary_residence" }]}
        liabilities={[]}
        businesses={[]}
        modelPortfolios={[]}
      />
    </ClientAccessProvider>,
  );
}

/** Props of the last mount of the asset-transaction dialog. */
function lastDialogProps() {
  expect(dialogProps.length).toBeGreaterThan(0);
  return dialogProps[dialogProps.length - 1];
}

// ---------------------------------------------------------------------------

describe("TechniquesView — asset-transaction bundle wiring", () => {
  beforeEach(() => {
    dialogProps.length = 0;
    global.fetch = vi.fn(() => Promise.resolve({ ok: false } as Response));
  });

  it("editing a bundled leg passes every leg of that bundle, itself included", () => {
    renderWithRows(ROWS);
    fireEvent.click(screen.getByRole("button", { name: "Edit Move house — Sell Oak" }));

    const records = lastDialogProps().bundleRecords;
    expect(records?.map((r) => r.id).sort()).toEqual(["a-buy", "a-sell"]);
    expect(records?.every((r) => r.bundleId === BUNDLE_A)).toBe(true);
  });

  it("editing a legacy row with no bundle id passes itself, not the other bundle-less rows", () => {
    // A record saved before bundles existed, and a second one alongside it.
    // Matching on a NULL bundleId would sweep both into one "bundle".
    const legacy = [txn({ id: "old-1", name: "Sell Duplex" }), txn({ id: "old-2", name: "Sell Land" })];
    renderWithRows(legacy);
    fireEvent.click(screen.getByRole("button", { name: "Edit Sell Duplex" }));

    expect(lastDialogProps().bundleRecords?.map((r) => r.id)).toEqual(["old-1"]);
  });

  it("editing a solo record makes the dialog bundle-aware: a one-element array holding itself", () => {
    // Not `undefined`. A bundle-blind dialog that grows this record derives a
    // name per leg but mints no shared id — two rows that look bundled and are
    // not. One element is what tells the dialog it may mint an id.
    renderWithRows(ROWS);
    fireEvent.click(screen.getByRole("button", { name: "Edit Sell Boat" }));

    const records = lastDialogProps().bundleRecords;
    expect(records).toHaveLength(1);
    expect(records?.[0].id).toBe("solo");
  });

  it("adding a new transaction passes no bundleRecords", () => {
    renderWithRows(ROWS);
    fireEvent.click(screen.getByText("+ Add Transaction"));

    expect(lastDialogProps().bundleRecords).toBeUndefined();
  });

  it("hands the dialog a purchase's property tax", () => {
    renderWithRows([
      txn({
        id: "solo-buy", name: "Buy House", type: "buy",
        accountId: null, assetName: "New House",
        assetCategory: "real_estate", assetSubType: "primary_residence",
        purchasePrice: "1500000",
        annualPropertyTax: "16500",
        propertyTaxGrowthRate: "0.0300",
        propertyTaxGrowthSource: "custom",
      }),
    ]);
    fireEvent.click(screen.getByRole("button", { name: /^Edit/i }));
    const initial = lastDialogProps().initialData;
    expect(initial?.annualPropertyTax).toBe("16500");
    expect(initial?.propertyTaxGrowthRate).toBe("0.0300");
    expect(initial?.propertyTaxGrowthSource).toBe("custom");
  });
});
