import { describe, it, expect } from "vitest";
import { runProjection } from "@/engine/projection";
import { buildClientData, sampleAccounts } from "@/engine/__tests__/fixtures";
import { LEGACY_FM_CLIENT, LEGACY_FM_SPOUSE } from "@/engine/ownership";
import { buildMonthlyCashFlowRows } from "../monthly-cash-flow";
import type { Account, ClientData, ProjectionYear } from "@/engine/types";

/**
 * The flag answers one question: is the Available figure for this year money
 * that actually exists? It does not, once the engine has run the household's
 * liquid portfolio below zero and kept paying anyway.
 *
 * The naive reading — "some household account ended the year negative" — is
 * WRONG, and these fixtures are built to prove it. A self-funding plan that
 * owns a default checking account ends nine of its thirty years with checking
 * a hair below zero (once by $3.29, otherwise by ~1e-11) while holding $3-5M
 * in liquid assets. See `naiveSignalYears` below, which is asserted live.
 */

/** Without an `isDefaultChecking` account the engine skips the whole surplus
 *  phase AND the checking gap-fill, so the plan never exercises the code path
 *  that produces the residual negatives. Shape copied from
 *  `monthly-cash-flow-split.test.ts` / `projection-surplus-allocation.test.ts`. */
const defaultChecking: Account = {
  id: "acct-checking",
  name: "Joint Checking",
  category: "cash",
  subType: "checking",
  titlingType: "jtwros",
  value: 10_000,
  basis: 10_000,
  growthRate: 0,
  rmdEnabled: false,
  isDefaultChecking: true,
  owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
};

/** Same portfolio, $1,000 an account, against an unchanged expense load: the
 *  plan spends itself to zero and the engine then overdrafts.
 *
 *  The $750k home keeps its full value on purpose. Home equity is not money the
 *  engine will ever draw on, and by the time these plans break the house is
 *  worth $1.4M — enough to mask a $99k hole and silence the flag in every year
 *  if real estate were ever counted as spendable. Shrinking the house too would
 *  hide that regression. Cash flow is unaffected: property tax is a fixed
 *  `annualPropertyTax`, so the depletion years are identical either way. */
const tinyLiquidAccounts: Account[] = sampleAccounts.map((a) =>
  a.category === "real_estate" ? a : { ...a, value: 1_000 },
);

const JOINT_OWNERS = [
  { kind: "family_member" as const, familyMemberId: LEGACY_FM_CLIENT, percent: 0.5 },
  { kind: "family_member" as const, familyMemberId: LEGACY_FM_SPOUSE, percent: 0.5 },
];

function build(clientData: ClientData) {
  const years = runProjection(clientData);
  const rows = buildMonthlyCashFlowRows(years, clientData, "nominal");
  return { years, rows };
}

const flaggedYears = (rows: { year: number; depleted: boolean }[]) =>
  rows.filter((r) => r.depleted).map((r) => r.year);

/** The years the PLAN'S ORIGINAL signal ("any household account ends below
 *  zero") would have fired. Asserted non-empty wherever it matters, so the
 *  "stays false" tests below can never pass by the trap having gone away. */
function naiveSignalYears(years: ProjectionYear[]): number[] {
  return years
    .filter((y) => Object.values(y.accountLedgers).some((l) => l.endingValue < 0))
    .map((y) => y.year);
}

/** Once the flag turns on it must stay on to the end of the plan — a hard
 *  "your money does not exist" alarm that blinks off and on again is noise.
 *  Observed true of both depleted fixtures here: the deficit compounds because
 *  a negative balance accrues negative growth and no later inflow reverses it. */
function expectContiguousToEnd(rows: { year: number; depleted: boolean }[]) {
  const first = rows.findIndex((r) => r.depleted);
  expect(first).toBeGreaterThanOrEqual(0);
  expect(flaggedYears(rows)).toEqual(rows.slice(first).map((r) => r.year));
}

/** A hand-built projection year, carrying only the fields the row builder
 *  reads. The engine cannot be coaxed into producing a synthetic equity
 *  destination account from a plain fixture plan, so that path is exercised
 *  here instead. */
function stubYear(args: {
  ledgers: Record<string, number>;
  syntheticAccounts?: ProjectionYear["syntheticAccounts"];
}): ProjectionYear {
  const accountLedgers: ProjectionYear["accountLedgers"] = {};
  for (const [id, endingValue] of Object.entries(args.ledgers)) {
    accountLedgers[id] = {
      beginningValue: 0,
      growth: 0,
      contributions: 0,
      distributions: 0,
      internalContributions: 0,
      internalDistributions: 0,
      rmdAmount: 0,
      fees: 0,
      endingValue,
      entries: [],
    };
  }
  return {
    year: 2026,
    ages: { client: 56, spouse: 54 },
    totalIncome: 0,
    withdrawals: { byAccount: {}, total: 0 },
    savings: { byAccount: {}, total: 0, employerTotal: 0 },
    expenses: {
      living: 0,
      liabilities: 0,
      other: 0,
      insurance: 0,
      realEstate: 0,
      taxes: 0,
      cashGifts: 0,
      discretionary: 0,
      total: 0,
      bySource: {},
      byLiability: {},
      interestByLiability: {},
    },
    accountLedgers,
    syntheticAccounts: args.syntheticAccounts,
  } as unknown as ProjectionYear;
}

describe("depletion flag", () => {
  it("is false in every year of a plan that funds itself", () => {
    const clientData = buildClientData();
    const { years, rows } = build(clientData);
    expect(rows).toHaveLength(30);
    expect(naiveSignalYears(years)).toEqual([]);
    expect(flaggedYears(rows)).toEqual([]);
  });

  it("is false in every year of a self-funding plan that owns a default checking account", () => {
    const clientData = buildClientData({ accounts: [defaultChecking, ...sampleAccounts] });
    const { years, rows } = build(clientData);
    expect(rows).toHaveLength(30);
    // Liveness: the plan really does hit the trap. Nine years end with checking
    // below zero — $3.29 in 2041, float dust in the rest — while the household
    // holds millions. If this ever goes empty the assertion below is vacuous.
    expect(naiveSignalYears(years).length).toBeGreaterThan(0);
    expect(flaggedYears(rows)).toEqual([]);
  });

  it("is true once the portfolio is exhausted and the engine overdrafts (no-checking plan)", () => {
    const clientData = buildClientData({ accounts: tinyLiquidAccounts });
    const { rows } = build(clientData);
    expect(flaggedYears(rows)[0]).toBe(2041);
    expectContiguousToEnd(rows);
  });

  it("waits for the portfolio to actually run out on a plan that owns checking", () => {
    const clientData = buildClientData({
      accounts: [{ ...defaultChecking, value: 1_000, basis: 1_000 }, ...tinyLiquidAccounts],
    });
    const { years, rows } = build(clientData);
    // 2041-2044 end with checking one or two CENTS below zero while the 401(k)
    // still holds $414k down to $24k. Real depletion starts in 2045, when
    // checking lands $92,483 in the hole with every other account at zero.
    const byYear = new Map(rows.map((r) => [r.year, r]));
    for (const y of [2041, 2042, 2043, 2044]) {
      expect(naiveSignalYears(years)).toContain(y);
      expect(byYear.get(y)!.depleted).toBe(false);
    }
    expect(flaggedYears(rows)[0]).toBe(2045);
    expectContiguousToEnd(rows);
  });

  it("flags depletion in an all-jointly-owned portfolio", () => {
    // Pins the household filter: `controllingFamilyMember` (the plan's cited
    // precedent) requires a single family-member owner at 100% and returns null
    // for every account here, which empties the set and silences the flag on a
    // portfolio that is $2.7M underwater.
    const clientData = buildClientData({
      accounts: [
        {
          id: "acct-brokerage",
          name: "Joint Brokerage",
          category: "taxable",
          subType: "brokerage",
          titlingType: "jtwros",
          value: 1_000,
          basis: 1_000,
          growthRate: 0.06,
          rmdEnabled: false,
          owners: JOINT_OWNERS,
        },
        {
          id: "acct-savings",
          name: "Emergency Fund",
          category: "cash",
          subType: "savings",
          titlingType: "jtwros",
          value: 1_000,
          basis: 1_000,
          growthRate: 0.04,
          rmdEnabled: false,
          owners: JOINT_OWNERS,
        },
      ],
      savingsRules: [],
      withdrawalStrategy: [
        { accountId: "acct-savings", priorityOrder: 1, startYear: 2026, endYear: 2055 },
        { accountId: "acct-brokerage", priorityOrder: 2, startYear: 2026, endYear: 2055 },
      ],
    });
    const { rows } = build(clientData);
    expect(flaggedYears(rows)[0]).toBe(2036);
    expectContiguousToEnd(rows);
  });

  it("money the household does not own cannot mask its depletion", () => {
    // The ledger's `endingValue` is the WHOLE account — it is never split by
    // ownership share — so anything counted here is counted in full. Three
    // shapes, each pinning a different half of the filter and each worth $7M by
    // 2041, against a household that is $2.1M underwater:
    //   · half client / half trust  → the "and NO entity owner" clause;
    //   · owned by someone outside the household → the "HAS a family-member
    //     owner" clause (a wholly trust-owned account is already caught by the
    //     entity clause, so it pins nothing on its own);
    //   · wholly trust-owned, kept as the plain-language case.
    const trustOwned: Account = {
      id: "trust-brokerage",
      name: "Family Trust Brokerage",
      category: "taxable",
      subType: "brokerage",
      titlingType: "jtwros",
      value: 3_000_000,
      basis: 3_000_000,
      growthRate: 0.06,
      rmdEnabled: false,
      owners: [{ kind: "entity", entityId: "ent-trust", percent: 1 }],
    };
    const clientAndTrust: Account = {
      ...trustOwned,
      id: "mixed-brokerage",
      name: "Client / Trust Brokerage",
      owners: [
        { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.5 },
        { kind: "entity", entityId: "ent-trust", percent: 0.5 },
      ],
    };
    const outsideTheHousehold: Account = {
      ...trustOwned,
      id: "outside-brokerage",
      name: "Beneficiary Brokerage",
      owners: [{ kind: "external_beneficiary", externalBeneficiaryId: "eb-1", percent: 1 }],
    };
    const clientData = buildClientData({
      accounts: [...tinyLiquidAccounts, trustOwned, clientAndTrust, outsideTheHousehold],
      entities: [
        {
          id: "ent-trust",
          name: "Family Trust",
          entityType: "trust",
          isIrrevocable: true,
          isGrantor: false,
          includeInPortfolio: false,
          grantor: "client",
        },
      ] as NonNullable<ClientData["entities"]>,
    });
    const { rows } = build(clientData);
    expect(flaggedYears(rows)[0]).toBe(2041);
    expectContiguousToEnd(rows);
  });
  it("counts engine-minted equity destination accounts as household money", () => {
    // The engine mints a household-owned taxable account on the first vest or
    // exercise (`projection.ts:1428-1456`) and reports it only on
    // `ProjectionYear.syntheticAccounts` — it is absent from `clientData`. No
    // fixture plan can produce one, so this year is hand-built.
    const clientData = buildClientData({ accounts: [defaultChecking] });
    const shares: NonNullable<ProjectionYear["syntheticAccounts"]> = [
      {
        id: "equity-dest-plan-1",
        name: "ACME shares",
        category: "taxable",
        owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
      },
    ];
    const overdrawnChecking = { "acct-checking": -50_000 };

    const withShares = buildMonthlyCashFlowRows(
      [stubYear({ ledgers: { ...overdrawnChecking, "equity-dest-plan-1": 400_000 }, syntheticAccounts: shares })],
      clientData,
      "nominal",
    );
    expect(withShares[0].depleted).toBe(false);

    // Control — without the shares the identical overdraft DOES flag, so the
    // `false` above is the synthetic balance doing the work, not an inert stub.
    const withoutShares = buildMonthlyCashFlowRows(
      [stubYear({ ledgers: overdrawnChecking })],
      clientData,
      "nominal",
    );
    expect(withoutShares[0].depleted).toBe(true);
  });
});
