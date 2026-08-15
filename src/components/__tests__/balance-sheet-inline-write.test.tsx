// @vitest-environment jsdom
/**
 * Integration coverage for the Net Worth page's inline write path — the half
 * that neither `row.test.tsx` (the presentational Row) nor the per-cell suites
 * can reach, because it only exists once `BalanceSheetView` wires a cell to
 * `saveAccountField` / `saveLiabilityField`.
 *
 * Three holes this closes, all left open by the asset-row task:
 *
 *   1. NOTHING called `saveAccountField`. Reverting its merged-row read
 *      (`pendingAccounts.rows.find` -> `accounts.find`) reddened no test, so
 *      the fix that stops a second in-flight edit silently reverting the first
 *      was entirely unpinned. Same for the liability writer added here.
 *   2. NO test passed a `growthContext` to `BalanceSheetView`, so deleting the
 *      whole `rateSlot` branch reddened nothing.
 *   3. The liability owner write must OMIT `titlingType` (liabilities have no
 *      such column) — a deliberate, documented exception to the global
 *      "titlingType always travels with owners" rule.
 *
 * Harness/fixture shape follows `balance-sheet-family-view-readonly.test.tsx`,
 * which already mounts the full view; the writer stub is the one addition.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ---------------------------------------------------------------------------
// Writer stub — hoisted so the `vi.mock` factory below can close over it.
//
// `submit` NEVER resolves on its own. Every test here depends on a save being
// still in flight while the next edit is made; a stub that resolved eagerly
// would let `router.refresh()`-shaped reconciliation run and the "stale row"
// bug would hide itself.
// ---------------------------------------------------------------------------
const stub = vi.hoisted(() => {
  const calls: { edit: Record<string, unknown>; base: Record<string, unknown> }[] = [];
  const submit = (edit: unknown, base: unknown) => {
    calls.push({
      edit: edit as Record<string, unknown>,
      base: base as Record<string, unknown>,
    });
    return new Promise<Response>(() => {});
  };
  return { calls, submit };
});

/** The `desiredFields` of the n-th (0-based) submit. */
function desiredFields(n: number): Record<string, unknown> {
  return stub.calls[n].edit.desiredFields as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Mocks — declared before any module imports
// ---------------------------------------------------------------------------

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => ({ get: vi.fn(() => null), toString: () => "" }),
  usePathname: () => "/clients/test-client/details",
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode; [k: string]: unknown }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

vi.mock("@/components/add-account-dialog", () => ({ default: () => null }));
vi.mock("@/components/add-liability-dialog", () => ({ default: () => null }));
vi.mock("@/components/business-dialog", () => ({ default: () => null }));
vi.mock("@/components/confirm-delete-dialog", () => ({ default: () => null }));
vi.mock("@/components/account-delete-dialog", () => ({ default: () => null }));
vi.mock("@/components/gift-dialog", () => ({ default: () => null }));

vi.mock("@/hooks/use-scenario-writer", () => ({
  useScenarioWriter: () => ({ submit: stub.submit, scenarioActive: false }),
}));
vi.mock("@/hooks/use-scenario-preserving-href", () => ({
  useScenarioPreservingHref: () => (href: string) => href,
}));
vi.mock("@/components/toast", () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));
vi.mock("@/lib/investments/holdings-client", () => ({
  refreshClientHoldingPrices: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------
import BalanceSheetView from "@/components/balance-sheet-view";
import { ClientAccessProvider } from "@/components/client-access-provider";
import type { CategoryDefaults } from "@/components/forms/add-account-form";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CLIENT_ID = "test-client-id";
const CLIENT_FM = "fm-client";
const SPOUSE_FM = "fm-spouse";

const FAMILY_MEMBERS = [
  { id: CLIENT_FM, role: "client" as const, firstName: "Alice" },
  { id: SPOUSE_FM, role: "spouse" as const, firstName: "Bob" },
];

const ACCOUNT = {
  id: "acct-1",
  name: "Brokerage Account",
  category: "taxable" as const,
  subType: "individual",
  owner: "client",
  value: "100000",
  basis: "80000",
  growthRate: null,
  growthSource: "default",
  modelPortfolioId: null,
  tickerPortfolioId: null,
  titlingType: "jtwros" as const,
  owners: [{ kind: "family_member" as const, familyMemberId: CLIENT_FM, percent: 1 }],
};

// A 30-year 4% mortgage taken out in 2020 with the stored balance as-of
// origination, so `currentYearBalance` has real amortization to do: the row
// displays LAST year's ending balance, never the stored `balance`. See the D1
// test below for the exact figures.
const LIABILITY = {
  id: "liab-1",
  name: "Home Mortgage",
  balance: "600000",
  interestRate: "0.04",
  monthlyPayment: "3000",
  startYear: 2020,
  startMonth: 1,
  termMonths: 360,
  termUnit: "monthly",
  balanceAsOfYear: 2020,
  balanceAsOfMonth: 1,
  owners: [{ kind: "family_member" as const, familyMemberId: CLIENT_FM, percent: 1 }],
};

const CATEGORY_DEFAULTS: CategoryDefaults = {
  taxable: "0.07",
  cash: "0.02",
  retirement: "0.07",
  annuity: "0.05",
  real_estate: "0.04",
  business: "0.06",
  stock_options: "0.07",
  life_insurance: "0.03",
  notes_receivable: "0.05",
};

// Decimal strings. NOT `growthContext.categoryDefaults` — see the naming trap
// in `lib/investments/category-default-rates.ts`. 0.062 -> "6.2% — Plan default".
const CATEGORY_DEFAULT_RATES = {
  taxable: "0.062",
  cash: "0.02",
  retirement: "0.07",
  education_savings: "0.07",
  annuity: "0.04",
  real_estate: "0.04",
  business: "0.05",
  stock_options: "0.07",
  life_insurance: "0.03",
  notes_receivable: "0",
};

const GROWTH_CONTEXT = {
  modelPortfolios: [],
  fundPortfolios: [],
  resolvedInflationRate: 0.025,
  categoryDefaults: {},
};

const BASE_PROPS = {
  clientId: CLIENT_ID,
  accounts: [ACCOUNT],
  liabilities: [LIABILITY],
  entities: [],
  familyMembers: FAMILY_MEMBERS,
  categoryDefaults: CATEGORY_DEFAULTS,
  ownerNames: { clientName: "Alice Test", spouseName: "Bob Test" },
  growthContext: GROWTH_CONTEXT,
  categoryDefaultRates: CATEGORY_DEFAULT_RATES,
};

function renderView(permission: "view" | "edit" = "edit") {
  return render(
    <ClientAccessProvider value={{ permission, access: "own" }}>
      <BalanceSheetView {...BASE_PROPS} />
    </ClientAccessProvider>,
  );
}

/** Assets live in a collapsed CategoryGroup; open it before touching a row. */
function expandTaxable() {
  fireEvent.click(screen.getAllByRole("button", { name: /taxable/i })[0]);
}

/** Type into the currently-open inline number field and commit with Enter. */
async function commitAmount(user: ReturnType<typeof userEvent.setup>, name: RegExp, next: string) {
  const input = screen.getByRole("textbox", { name });
  await user.clear(input);
  await user.type(input, `${next}{Enter}`);
}

beforeEach(() => {
  stub.calls.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// 1. The merged-row base — the second edit must carry the first's optimistic
//    value, on BOTH halves of the page.
// ---------------------------------------------------------------------------

describe("BalanceSheetView inline writes read the MERGED rows", () => {
  it("carries an in-flight account edit into the next account write", async () => {
    const user = userEvent.setup();
    renderView();
    expandTaxable();

    // Edit 1: the value. Never resolves, so it is still pending below.
    await user.click(screen.getByRole("button", { name: "Edit amount for Brokerage Account" }));
    await commitAmount(user, /^Amount for Brokerage Account$/, "150000");
    expect(desiredFields(0).value).toBe("150000");

    // Edit 2: the owner, while edit 1 is still in flight.
    await user.click(screen.getByRole("button", { name: "Change owner for Brokerage Account" }));
    await user.selectOptions(
      screen.getByRole("combobox", { name: /^Owner for Brokerage Account$/ }),
      "spouse",
    );

    // Built from `accounts.find` this would be the ORIGINAL 100000 and the
    // scenario write would silently revert edit 1.
    expect(desiredFields(1).value).toBe("150000");
  });

  it("carries an in-flight liability edit into the next liability write", async () => {
    const user = userEvent.setup();
    renderView();

    // Edit 1: the balance.
    await user.click(screen.getByRole("button", { name: "Edit amount for Home Mortgage" }));
    await commitAmount(user, /^Amount for Home Mortgage$/, "550000");
    expect(desiredFields(0).balance).toBe("550000");

    // Edit 2: the interest rate, while edit 1 is still in flight.
    await user.click(screen.getByRole("button", { name: "Edit interest rate for Home Mortgage" }));
    await commitAmount(user, /^Interest rate for Home Mortgage$/, "5");

    expect(desiredFields(1).interestRate).toBe("0.05");
    // Built from `liabilities.find` this would be the ORIGINAL 600000.
    expect(desiredFields(1).balance).toBe("550000");
  });
});

// ---------------------------------------------------------------------------
// 2. The rate cell on asset rows — that it exists at all, and that its
//    "Plan default" label is a PERCENT.
// ---------------------------------------------------------------------------

describe("BalanceSheetView asset growth cell", () => {
  it("renders a growth-rate cell when a growthContext is supplied", () => {
    renderView();
    expandTaxable();
    expect(
      screen.getByRole("button", { name: "Change growth rate for Brokerage Account" }),
    ).toBeInTheDocument();
  });

  // Deliberately its own `it`. The cell existing and the cell being fed the
  // right units are different failures: a rate cell wired to the WRONG map
  // still renders, so only an assertion on the label text can discriminate.
  it("labels Plan default with the percent form of categoryDefaultRates", async () => {
    const user = userEvent.setup();
    renderView();
    expandTaxable();
    await user.click(screen.getByRole("button", { name: "Change growth rate for Brokerage Account" }));
    // 0.062 -> 6.2%. A decimal here would read "0.06% — Plan default".
    expect(screen.getByRole("option", { name: /^6\.2% — Plan default$/ })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 3. The liability owner write drops `titlingType` on purpose.
// ---------------------------------------------------------------------------

describe("BalanceSheetView liability owner write", () => {
  it("writes owners WITHOUT titlingType — liabilities have no such column", async () => {
    const user = userEvent.setup();
    renderView();

    await user.click(screen.getByRole("button", { name: "Change owner for Home Mortgage" }));
    await user.selectOptions(
      screen.getByRole("combobox", { name: /^Owner for Home Mortgage$/ }),
      "spouse",
    );

    expect(desiredFields(0).owners).toEqual([
      { kind: "family_member", familyMemberId: SPOUSE_FM, percent: 1 },
    ]);
    // The global "titlingType always travels with owners" rule has exactly one
    // exception, and this is it: `LiabilityRow` has no titling column, so
    // emitting the key would invent one. See the call-site comment.
    expect(desiredFields(0)).not.toHaveProperty("titlingType");
    expect(stub.calls[0].base.body).not.toHaveProperty("titlingType");
  });

  // Its own `it`: sending the right payload and SHOWING the change are
  // different failures. This one pins that the optimistic overlay reaches the
  // rendered row — i.e. that the top-level filter runs over the MERGED rows.
  // Overlaying after the filter drops every optimistic value on the way in.
  it("shows the new owner immediately, before the write resolves", async () => {
    const user = userEvent.setup();
    renderView();

    await user.click(screen.getByRole("button", { name: "Change owner for Home Mortgage" }));
    await user.selectOptions(
      screen.getByRole("combobox", { name: /^Owner for Home Mortgage$/ }),
      "spouse",
    );

    expect(
      screen.getByRole("button", { name: "Change owner for Home Mortgage" }),
    ).toHaveTextContent("Bob Test");
  });
});

// ---------------------------------------------------------------------------
// 4. Read display vs edit value on a liability balance — deliberately DIFFERENT
//    numbers.
// ---------------------------------------------------------------------------

describe("BalanceSheetView liability balance cell", () => {
  // `currentYearBalance` back-solves the original balance and returns LAST
  // year's ending balance off the amortization schedule; the stored `balance`
  // is the as-of principal. Frozen clock so the expected figure cannot rot.
  // 600000 @ 4% / $3,000pm from 2020-01 -> 2025 ending balance = 518,777.44.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-15T12:00:00Z"));
  });

  it("shows the projected current-year balance in read mode", () => {
    renderView();
    expect(
      screen.getByRole("button", { name: "Edit amount for Home Mortgage" }),
    ).toHaveTextContent("($518,777)");
  });

  // Its own `it`: showing the amortized figure and EDITING the stored principal
  // are separate properties, and a single `InlineAmount amount=` would satisfy
  // one while corrupting the other.
  it("opens the editor on the stored principal, not on the amortized figure", () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "Edit amount for Home Mortgage" }));
    expect(screen.getByRole("textbox", { name: /^Amount for Home Mortgage$/ })).toHaveValue(
      "600,000",
    );
  });

  // `Row` applies `valueClassName` only in the FALLBACK branch, so supplying a
  // `valueSlot` silently drops the red. The colour has to come through the
  // cell's own `className`, and nothing else in the suite would notice if it
  // stopped.
  it("keeps the balance red once the cell replaces the plain span", () => {
    renderView();
    expect(screen.getByRole("button", { name: "Edit amount for Home Mortgage" }).className).toContain(
      "text-red-400",
    );
  });
});

// ---------------------------------------------------------------------------
// 5. Read-only gating on the liability row.
// ---------------------------------------------------------------------------

describe("BalanceSheetView liability row under permission='view'", () => {
  it("still shows the interest rate, as plain text", () => {
    renderView("view");
    const rows = screen.getAllByText("Home Mortgage")[0].closest("div.flex.items-center.justify-between");
    expect(within(rows as HTMLElement).getByText("4.00%")).toBeInTheDocument();
  });

  // Its own `it`: the rate being VISIBLE and the rate being NON-EDITABLE are
  // different failures.
  it("offers no way to edit the interest rate", () => {
    renderView("view");
    expect(
      screen.queryByRole("button", { name: "Edit interest rate for Home Mortgage" }),
    ).toBeNull();
  });

  it("offers no pencil into the liability dialog", () => {
    renderView("view");
    expect(screen.queryByRole("button", { name: "Edit Home Mortgage" })).toBeNull();
  });

  it("offers the pencil under permission='edit'", () => {
    renderView("edit");
    expect(screen.queryByRole("button", { name: "Edit Home Mortgage" })).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 5. Equity rows — the value cell is READ-ONLY.
//
//    A stock_options account's displayed value is derived from its grants
//    (`lib/accounts/equity-derived-values.ts`); the stored column is a
//    permanent "0". An editable cell here would accept a number that the next
//    render silently recomputes away, and — before the category strip in
//    `buildScenarioDesiredFields` — would have persisted the derived figure as
//    real data.
// ---------------------------------------------------------------------------

describe("BalanceSheetView equity rows", () => {
  const EQUITY_ACCOUNT = {
    ...ACCOUNT,
    id: "so-1",
    name: "TSLA Options",
    category: "stock_options" as const,
    subType: "rsu",
    value: "42000",
    basis: "0",
  };

  function renderWithEquity() {
    return render(
      <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
        <BalanceSheetView {...BASE_PROPS} accounts={[ACCOUNT, EQUITY_ACCOUNT]} />
      </ClientAccessProvider>,
    );
  }

  it("offers no amount editor on a stock_options row", () => {
    renderWithEquity();
    fireEvent.click(screen.getAllByRole("button", { name: /stock options/i })[0]);

    // The row is on screen and shows its derived value...
    expect(screen.getByText("TSLA Options")).toBeTruthy();
    // ...but nothing offers to edit it.
    expect(screen.queryByRole("button", { name: "Edit amount for TSLA Options" })).toBeNull();
  });

  it("still offers one on an ordinary asset row in the same table", () => {
    // Negative control: proves the assertion above is about the CATEGORY and
    // not about the row being missing, the group being collapsed, or edit
    // permission being off.
    renderWithEquity();
    expandTaxable();
    expect(screen.getByRole("button", { name: "Edit amount for Brokerage Account" })).toBeTruthy();
  });
});
