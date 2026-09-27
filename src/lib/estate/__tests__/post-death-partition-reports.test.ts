// The report layer after a first-death partition.
//
// At the first death a mixed account (30% gifted to a trust, or authored 30%
// trust-owned) becomes TWO engine accounts: the family pool under the original
// id — 700k, wholly the survivor's — and the trust's own 300k slice under a
// synthetic id. The reports used to re-resolve the AUTHORED account (plus the
// gift overlay) against the pool's ledger: they took the trust's 30% out of the
// pool a second time and never saw the slice. The household read 400k.
//
// Every number here comes off a real runProjection and the real reader. One
// $1M account, growth 0, a 30% gift in 2027, the client dies in 2029.

import { describe, it, expect } from "vitest";
import { runProjection, type ProjectionResult } from "@/engine";
import { buildClientData, basePlanSettings, baseClient } from "@/engine/__tests__/fixtures";
import { LEGACY_FM_CLIENT, LEGACY_FM_SPOUSE } from "@/engine/ownership";
import type {
  Account,
  ClientData,
  EntitySummary,
  FamilyMember,
  GiftEvent,
  ProjectionYear,
  Will,
} from "@/engine/types";
import { computeInEstateAtYear, computeOutOfEstateAtYear } from "../in-estate-at-year";
import { rankTrustsByContribution } from "../strategy-attribution";
import { buildYearlyLiquidityReport } from "../yearly-liquidity-report";
import { buildBalanceSheetReportProps } from "@/lib/balance-sheet/build-report-props";
import { buildViewModel } from "@/components/balance-sheet-report/view-model";
import { treeAsOfYear } from "@/app/(app)/clients/[id]/estate-planning/lib/tree-as-of-year";

const ACC = "acct-x";
const TRUST = "trust-1";
const KID = "kid-a";

const FAMILY: FamilyMember[] = [
  { id: LEGACY_FM_CLIENT, role: "client", relationship: "other",
    firstName: "Client", lastName: "Test", dateOfBirth: "1960-01-01" },
  { id: LEGACY_FM_SPOUSE, role: "spouse", relationship: "other",
    firstName: "Spouse", lastName: "Test", dateOfBirth: "1972-06-15" },
  { id: KID, role: "child", relationship: "child",
    firstName: "Kid", lastName: "Test", dateOfBirth: "1995-01-01" },
];

const trust: EntitySummary = {
  id: TRUST, name: "Trust One", entityType: "trust", trustSubType: "irrevocable",
  isIrrevocable: true, isGrantor: false, includeInPortfolio: false,
  accessibleToClient: false, grantor: "client",
};

const toTrust = (year: number, percent: number, grantor: "client" | "spouse" = "client"): GiftEvent => ({
  kind: "asset", year, accountId: ACC, percent, grantor, recipientEntityId: TRUST,
});

const CLIENT_ONLY: Account["owners"] = [
  { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 },
];
const JOINT: Account["owners"] = [
  { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.5 },
  { kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 0.5 },
];
const CLIENT_AND_TRUST: Account["owners"] = [
  { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.7 },
  { kind: "entity", entityId: TRUST, percent: 0.3 },
];

/** Everything to the spouse and the kid, half each: the death SPLITS the pool. */
const SPLIT_WILL = {
  id: "will-c", grantor: "client",
  bequests: [{
    id: "beq", name: "Split", kind: "asset", assetMode: "all_assets",
    accountId: null, liabilityId: null, entityId: null,
    percentage: 100, condition: "always", sortOrder: 0,
    recipients: [
      { recipientKind: "spouse", recipientId: null, percentage: 50, sortOrder: 0 },
      { recipientKind: "family_member", recipientId: KID, percentage: 50, sortOrder: 1 },
    ],
  }],
} as unknown as Will;

/** Client dies 2029; the spouse outlives the horizon unless `spouseDies` (2031). */
function plan(opts: {
  gifts: GiftEvent[];
  owners?: Account["owners"];
  spouseDies?: boolean;
  endYear?: number;
  wills?: Will[];
  needs?: Array<{ year: number; amount: number }>;
  entities?: EntitySummary[];
}): ClientData {
  const endYear = opts.endYear ?? 2033;
  const acct: Account = {
    id: ACC, name: "Brokerage", category: "taxable", subType: "brokerage",
    titlingType: "jtwros", value: 1_000_000, basis: 400_000, growthRate: 0,
    rmdEnabled: false, owners: opts.owners ?? CLIENT_ONLY,
  };
  const checking: Account = {
    id: "acct-checking", name: "Checking", category: "cash", subType: "checking",
    titlingType: "jtwros", value: 1000, basis: 1000, growthRate: 0,
    rmdEnabled: false, isDefaultChecking: true, owners: JOINT,
  };
  return buildClientData({
    client: { ...baseClient, dateOfBirth: "1960-01-01", spouseDob: "1972-06-15",
      lifeExpectancy: 69, spouseLifeExpectancy: opts.spouseDies ? 59 : 95 },
    familyMembers: FAMILY, accounts: [checking, acct], entities: opts.entities ?? [trust],
    incomes: [], liabilities: [], savingsRules: [],
    expenses: (opts.needs ?? []).map((n, i) => ({
      id: `need-${i}`, name: "Living", type: "living" as const, annualAmount: n.amount,
      growthRate: 0, startYear: n.year, endYear: n.year,
    })),
    withdrawalStrategy: [{ accountId: ACC, priorityOrder: 1, startYear: 2026, endYear }],
    giftEvents: opts.gifts,
    wills: opts.wills ?? [],
    planSettings: { ...basePlanSettings, flatFederalRate: 0, flatStateRate: 0,
      planStartYear: 2026, planEndYear: endYear },
  });
}

const at = (years: ProjectionYear[], year: number) => {
  const y = years.find((r) => r.year === year);
  if (!y) throw new Error(`no projection row for ${year}`);
  return y;
};

/** In / out of estate exactly as the estate scrubber builds its arguments. */
function estateAt(data: ClientData, years: ProjectionYear[], year: number) {
  const py = at(years, year);
  const accountBalances = new Map<string, number>();
  for (const [id, ledger] of Object.entries(py.accountLedgers)) accountBalances.set(id, ledger.endingValue);
  const args = {
    tree: data, giftEvents: data.giftEvents ?? [], year, projectionStartYear: 2026,
    accountBalances,
    entityAccountSharesEoY: py.entityAccountSharesEoY,
    familyAccountSharesEoY: py.familyAccountSharesEoY,
    accountOwners: py.accountOwners,
  };
  return { inEstate: computeInEstateAtYear(args), outOfEstate: computeOutOfEstateAtYear(args) };
}

/** The Balance Sheet report's consolidated view, built the way the page builds it. */
function balanceSheetAt(data: ClientData, years: ProjectionYear[], year: number) {
  const props = buildBalanceSheetReportProps(data, years, { clientLabel: "Client", spouseName: "Spouse" });
  return buildViewModel({
    accounts: props.accounts, liabilities: props.liabilities, entities: props.entities,
    familyMembers: props.familyMembers, projectionYears: props.projectionYears,
    selectedYear: year, view: "consolidated", asOfMode: "eoy", giftEvents: props.giftEvents,
  });
}

describe("reports after a first-death partition — a 30% gift to a trust", () => {
  const data = plan({ gifts: [toTrust(2027, 0.3)] });
  const years = runProjection(data);

  it("keeps the whole 700k pool in the estate and the trust's 300k slice out of it", () => {
    // Was 401k / 300k: the pool re-gifted, the slice invisible.
    expect(estateAt(data, years, 2030)).toEqual({
      inEstate: expect.closeTo(701_000, 2), outOfEstate: expect.closeTo(300_000, 2),
    });
  });

  it("shows the trust's slice as ONE 300k Brokerage row and the household at 701k", () => {
    const vm = balanceSheetAt(data, years, 2030);
    const trustRows = vm.outOfEstateRows.filter((r) => r.accountId === ACC);
    expect(trustRows).toHaveLength(1);
    expect(trustRows[0].accountName).toBe("Brokerage");
    expect(trustRows[0].value).toBeCloseTo(300_000, 2);
    expect(vm.totalAssets).toBeCloseTo(701_000, 2);
  });
});

describe("reports after a first-death partition — a later gift of the pool to the same trust", () => {
  // 20% of the 700k pool to the trust in 2031: trust 300k slice + 140k.
  const data = plan({ gifts: [toTrust(2027, 0.3), toTrust(2031, 0.2, "spouse")] });
  const years = runProjection(data);

  it("shows the trust once, at 440k, and the household at 560k + checking", () => {
    const vm = balanceSheetAt(data, years, 2031);
    const trustRows = vm.outOfEstateRows.filter((r) => r.accountId === ACC);
    expect(trustRows).toHaveLength(1); // no duplicate `acct-x#en:trust-1` row
    expect(trustRows[0].value).toBeCloseTo(440_000, 2);
    expect(vm.totalAssets).toBeCloseTo(561_000, 2);
    const keys = [...vm.outOfEstateRows, ...vm.assetCategories.flatMap((c) => c.rows)].map((r) => r.rowKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("reports after a first-death partition — a joint account", () => {
  const data = plan({ gifts: [toTrust(2027, 0.3)], owners: JOINT, spouseDies: true });
  const years = runProjection(data);

  it("gives the survivor the whole 700k pool and the trust its 300k slice", () => {
    // Engine-side fix alone gave the household 700k AND a 210k trust share of
    // the same 700k pool; lib-side alone left the household at 400k.
    const vm = balanceSheetAt(data, years, 2030);
    expect(vm.totalAssets).toBeCloseTo(701_000, 2);
    expect(vm.outOfEstateRows.filter((r) => r.accountId === ACC).reduce((s, r) => s + r.value, 0))
      .toBeCloseTo(300_000, 2);
  });
});

describe("reports after a first-death partition — an authored 70/30 client/trust account", () => {
  const data = plan({ gifts: [], owners: CLIENT_AND_TRUST });
  const years = runProjection(data);

  it("values the trust's strategy card at its 300k slice", () => {
    const ranked = rankTrustsByContribution(data, years);
    expect(ranked.find((r) => r.trustId === TRUST)?.primaryAmount).toBeCloseTo(300_000, 2);
  });

  it("shows the estate canvas the pool as the survivor's 700k and the trust's 300k", () => {
    const tree = treeAsOfYear(data, { years } as unknown as ProjectionResult, 2030, "eoy");
    const acct = tree.accounts.find((a) => a.id === ACC)!;
    const dollars = (pick: (o: Account["owners"][number]) => boolean) =>
      acct.owners.filter(pick).reduce((s, o) => s + acct.value * o.percent, 0);
    expect(dollars((o) => o.kind === "family_member" && o.familyMemberId === LEGACY_FM_SPOUSE))
      .toBeCloseTo(700_000, 2);
    expect(dollars((o) => o.kind === "entity" && o.entityId === TRUST)).toBeCloseTo(300_000, 2);
    // Was 400k / 300k: the trust's stale lock on the pool.
  });
});

describe("reports after a first-death partition — a will splits the pool", () => {
  const data = plan({ gifts: [toTrust(2027, 0.3)], wills: [SPLIT_WILL], endYear: 2032 });
  const years = runProjection(data);

  it("folds the will's shares and the trust's slice back into the account", () => {
    // The pool is gone (split 350k spouse / 350k kid). The kid's inherited half
    // is a family-member row, which the in-estate weights count as in-estate —
    // so the household figure is 701k, as before this change (a spouse-only
    // 351k needs heir-aware weights, out of scope); the trust is counted once.
    expect(estateAt(data, years, 2030)).toEqual({
      inEstate: expect.closeTo(701_000, 2), outOfEstate: expect.closeTo(300_000, 2),
    });
  });
});

describe("reports after a first-death partition — a drained pool with a revocable trust's slice", () => {
  // Authored 70% client / 30% REVOCABLE trust (in the estate). The survivor
  // spends the whole 700k pool in 2030; the trust's 300k slice is untouched.
  const revocable: EntitySummary = { ...trust, isIrrevocable: false, trustSubType: undefined };
  const data = plan({
    gifts: [], owners: CLIENT_AND_TRUST, entities: [revocable], endYear: 2031,
    needs: [{ year: 2030, amount: 800_000 }],
  });
  const years = runProjection(data);

  it("still counts the slice in the liquidity report's portfolio assets", () => {
    const y2030 = at(years, 2030);
    expect(y2030.accountLedgers[ACC].endingValue).toBeCloseTo(0, 2);
    const report = buildYearlyLiquidityReport({
      projection: { years }, clientData: data,
      ownerNames: { clientName: "Client", spouseName: "Spouse" },
      ownerDobs: { clientDob: "1960-01-01", spouseDob: "1972-06-15" },
    });
    const row = report.rows.find((r) => r.year === 2030)!;
    // The zero-balance guard used to skip the drained pool BEFORE its slice
    // was folded in, dropping the trust's 300k.
    // (The overdrawn checking contributes nothing: an owner slice floors at 0.)
    expect(y2030.accountLedgers["acct-checking"].endingValue).toBeLessThan(0);
    expect(row.totalPortfolioAssets).toBeCloseTo(300_000, 2);
  });
});
