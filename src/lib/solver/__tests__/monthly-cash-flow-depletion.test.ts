import { describe, it, expect } from "vitest";
import { runProjection } from "@/engine/projection";
import {
  basePlanSettings,
  buildClientData,
  sampleAccounts,
  sampleExpenses,
} from "@/engine/__tests__/fixtures";
import { LEGACY_FM_CLIENT, LEGACY_FM_SPOUSE } from "@/engine/ownership";
import { buildMonthlyCashFlowRows } from "../monthly-cash-flow";
import type { Account, ClientData, ProjectionYear } from "@/engine/types";
import type { StockOptionPlan } from "@/engine/equity/types";

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

/** Contiguity is a property OF THESE FIXTURES, not of the signal — asserted
 *  because it is what "your money does not exist" ought to look like, but it is
 *  observed, not guaranteed. It holds on both depleted fixtures here because the
 *  deficit compounds (a negative balance accrues negative growth) and no later
 *  inflow reverses it. It is NOT something the signal enforces: the same signal
 *  flags non-contiguously on the narrow-set fixture below the moment the
 *  tolerance is removed. A plan with a large late inflow could legitimately
 *  recover, and this assertion should then be relaxed rather than the signal
 *  contorted. */
function expectContiguousToEnd(rows: { year: number; depleted: boolean }[]) {
  const first = rows.findIndex((r) => r.depleted);
  expect(first).toBeGreaterThanOrEqual(0);
  expect(flaggedYears(rows)).toEqual(rows.slice(first).map((r) => r.year));
}

/**
 * A household whose liquid set NARROWS TO ONE ACCOUNT, which is the shape the
 * tolerance exists for.
 *
 * Ruling 5 excludes any account carrying an entity owner wholesale, so a
 * client-owned checking account sitting beside a single 50/50 client / family-
 * trust brokerage leaves the sum reading CHECKING AND NOTHING ELSE. Summing
 * never removed the engine's gap-fill residue — it only hid it behind millions
 * in other accounts. Narrow the set and the residue IS the sum.
 *
 * Both households below are grossly solvent, and both flag without the
 * tolerance.
 */
function narrowHouseholdPlan(brokerageValue: number, livingAnnual: number): ClientData {
  return buildClientData({
    accounts: [
      {
        ...defaultChecking,
        name: "Client Checking",
        owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
      },
      {
        id: "mixed-brokerage",
        name: "Client / Trust Brokerage",
        category: "taxable",
        subType: "brokerage",
        titlingType: "jtwros",
        value: brokerageValue,
        basis: brokerageValue,
        growthRate: 0.06,
        rmdEnabled: false,
        owners: [
          { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.5 },
          { kind: "entity", entityId: "ent-trust", percent: 0.5 },
        ],
      },
    ],
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
    savingsRules: [],
    expenses: sampleExpenses.map((e) =>
      e.type === "living" ? { ...e, annualAmount: livingAnnual } : e,
    ),
    withdrawalStrategy: [
      { accountId: "mixed-brokerage", priorityOrder: 1, startYear: 2026, endYear: 2055 },
    ],
  });
}

/** The worst end-of-year checking balance the engine leaves behind. On a narrow
 *  household this IS the whole liquid sum, so it is exactly what the tolerance
 *  is measured against. */
function worstCheckingResidue(years: ProjectionYear[]): number {
  return Math.min(...years.map((y) => y.accountLedgers["acct-checking"]?.endingValue ?? 0));
}

/**
 * An RSU plan whose vested shares land in an account the engine MINTS. It is
 * reported only on `ProjectionYear.syntheticAccounts` and never appears in
 * `clientData.accounts`. Shape follows
 * `src/engine/__tests__/equity-reporting.integration.test.ts`.
 */
const equityPlan: StockOptionPlan = {
  accountId: "so-equity",
  ticker: "ACME",
  pricePerShare: 420,
  growthRate: 0.07,
  destinationAccountId: null,
  autoCreateDestination: true,
  sellToCover: true,
  withholdingRate: 0.22,
  strategy: {
    exerciseTiming: "at_vest",
    exerciseYear: null,
    sellTiming: "hold",
    sellYear: null,
    sellPercentPerYear: null,
    sellStartYear: null,
  },
  owner: "client",
  grants: [
    {
      id: "g-rsu",
      grantNumber: "RSU-1",
      grantType: "rsu",
      grantDate: "2025-01-15",
      sharesGranted: 4_000,
      has83bElection: false,
      fmvAtGrant: null,
      strikePrice: null,
      strikeDiscountPct: null,
      expirationYear: null,
      // Sold beyond the plan horizon, so the shares are HELD for every year here.
      strategy: { sellTiming: "hold_then_sell_year", sellYear: 2060 },
      tranches: [2027, 2028, 2029, 2030].map((vestYear) => ({
        id: `t-rsu-${vestYear}`,
        vestDate: `${vestYear}-01-15`,
        shares: 1_000,
        sharesExercised: 0,
        sharesSold: 0,
        acquiredOn: null,
        priceAtAcquisition: null,
        strategy: null,
      })),
      plannedEvents: [],
    },
  ],
};

/** The base `stock_options` account the plan hangs off. `stock_options` is NOT
 *  in `LIQUID_PORTFOLIO_CATEGORIES`, so this account contributes nothing — only
 *  the minted destination does. */
const soAccount: Account = {
  id: "so-equity",
  name: "ACME Equity",
  category: "stock_options",
  subType: "stock_options",
  titlingType: "jtwros",
  value: 0,
  basis: 0,
  growthRate: 0.07,
  rmdEnabled: false,
  owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
};

describe("depletion flag", () => {
  it("is false in every year of a plan that funds itself", () => {
    const clientData = buildClientData();
    const { years, rows } = build(clientData);
    expect(rows).toHaveLength(30);
    // FIXTURE CHARACTERIZATION, not coverage. It records that this plan never
    // trips the naive signal either, which is why it cannot stand in for the
    // with-checking test below. NO implementation of `depleted` can fail this
    // line — it reads the engine directly and never touches the module.
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

  it("is false in every year of a self-funding household whose liquid set narrows to ONE account", () => {
    // The wide fixtures above cannot prove the tolerance: they hold four or five
    // accounts summing to $1.1M-$4.9M, so no per-account residue can flip the
    // sign and `toEqual([])` would pass with the tolerance deleted. These two
    // narrow to checking alone.
    for (const [brokerageValue, livingAnnual] of [
      // The shape the reviewer reproduced: residue is float dust (~1e-11), and
      // the flag fires NON-CONTIGUOUSLY without the tolerance.
      [4_000_000, 80_000],
      // The same shape at UHNW scale, where the residue is DOLLARS rather than
      // dust. This is the case that decides 10 over 1.
      [100_000_000, 2_000_000],
    ] as const) {
      const clientData = narrowHouseholdPlan(brokerageValue, livingAnnual);

      // The set really does narrow: two accounts, and the big one is co-owned by
      // the trust, which Ruling 5 excludes wholesale. Without this guard the
      // fixture could silently widen and stop testing anything.
      expect(clientData.accounts).toHaveLength(2);
      expect(
        clientData.accounts.filter((a) => (a.owners ?? []).every((o) => o.kind === "family_member")),
      ).toHaveLength(1);

      const { years, rows } = build(clientData);
      // Liveness: 30 real rows, not an empty array `toEqual([])` would accept.
      expect(rows).toHaveLength(30);
      // Liveness: the plan really does hit the residue, so the assertion below
      // cannot pass by the trap having gone away.
      expect(naiveSignalYears(years).length).toBeGreaterThan(0);
      // And the household is not remotely short of money.
      const finalBrokerage = years.at(-1)!.accountLedgers["mixed-brokerage"]!.endingValue;
      expect(finalBrokerage).toBeGreaterThan(brokerageValue);

      expect(flaggedYears(rows)).toEqual([]);
    }
  });

  it("tolerates the engine's DOLLAR-scale gap-fill residue, not just float dust", () => {
    // Ruling 1: a tolerance of 1 would not have been enough. The engine's
    // phase-12 convergence loop carries its own `const TOLERANCE = 1`, so the
    // gap-fill is allowed to undershoot by dollars — and the undershoot SCALES
    // with the plan. On this $100M household it lands at about -$5.33, which is
    // past 1 and inside 10. Pinned as a range so the day the residue outgrows
    // the tolerance this reds instead of the flag quietly lying.
    const { years, rows } = build(narrowHouseholdPlan(100_000_000, 2_000_000));
    const residue = worstCheckingResidue(years);
    expect(residue).toBeLessThan(-1);
    expect(residue).toBeGreaterThan(-10);
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
    // exercise and reports it ONLY on `ProjectionYear.syntheticAccounts` — it is
    // absent from `clientData.accounts`. Everything below is engine-produced:
    // an RSU plan whose four tranches vest 2027-2030 and are held, against a
    // household with $1,000 of savings and a spending spike from 2032.
    const clientData = buildClientData({
      accounts: [
        soAccount,
        {
          id: "acct-savings",
          name: "Emergency Fund",
          category: "cash",
          subType: "savings",
          titlingType: "jtwros",
          value: 1_000,
          basis: 1_000,
          growthRate: 0,
          rmdEnabled: false,
          owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
        },
      ],
      savingsRules: [],
      stockOptionPlans: [equityPlan],
      expenses: [
        ...sampleExpenses,
        {
          id: "exp-spike",
          type: "living",
          name: "Late splurge",
          annualAmount: 400_000,
          startYear: 2032,
          endYear: 2040,
          growthRate: 0,
        },
      ],
      withdrawalStrategy: [
        { accountId: "acct-savings", priorityOrder: 1, startYear: 2026, endYear: 2040 },
      ],
      planSettings: { ...basePlanSettings, planEndYear: 2040 },
    });
    const { years, rows } = build(clientData);

    // The sidecar is REAL: id, category and owners all come out of
    // `runProjection`, so a change to the engine's minted shape reds here rather
    // than silently dropping the account out of the household sum.
    const sidecar = years.find((y) => y.year === 2030)!.syntheticAccounts!;
    expect(sidecar).toHaveLength(1);
    expect(sidecar[0]).toMatchObject({
      id: "equity-dest-so-equity",
      category: "taxable",
      owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
    });

    // 2038 is the year the engine overdrafts the MINTED account itself:
    // savings is at zero and the destination finishes -$431,600.
    expect(years.find((y) => y.year === 2038)!.accountLedgers["equity-dest-so-equity"]!.endingValue)
      .toBeLessThan(-400_000);
    expect(flaggedYears(rows)[0]).toBe(2038);
    expectContiguousToEnd(rows);

    // Control — the same engine years with the sidecar removed. The destination
    // drops out of the household set, its overdraft goes uncounted, and the
    // alarm arrives a year late. So the 2038 above is the sidecar doing the
    // work, not the rest of the portfolio.
    const withoutSidecar = buildMonthlyCashFlowRows(
      years.map((y) => ({ ...y, syntheticAccounts: undefined })),
      clientData,
      "nominal",
    );
    expect(flaggedYears(withoutSidecar)[0]).toBe(2039);
  });
});
