/**
 * The death chains pay the will's gifts in one ordered pass over the whole
 * will-passing estate (`allocateWillGifts`), after titling and beneficiary
 * designations and before the remainder estate. A dollar gift draws only on
 * cash and brokerage — a home or business is never carved up to pay it.
 */

import { describe, it, expect } from "vitest";
import { applyFirstDeath, applyFinalDeath } from "../index";
import type { DeathEventInput, DeathEventResult } from "../index";
import type {
  Account,
  EntitySummary,
  FamilyMember,
  Liability,
  PlanSettings,
  Will,
  WillBequest,
  WillBequestRecipient,
} from "../../types";
import { LEGACY_FM_CLIENT, LEGACY_FM_SPOUSE } from "../../ownership";
import { _resetSyntheticIdCounter } from "../../asset-transactions";

const CHILD_A = "00000000-0000-0000-0000-0000000000aa";
const CHILD_B = "00000000-0000-0000-0000-0000000000bb";
const SARAH = "00000000-0000-0000-0000-0000000000cc";
const CHARITY = "ext-charity";

const FMS: FamilyMember[] = [
  { id: LEGACY_FM_CLIENT, role: "client", relationship: "other", firstName: "Pat", lastName: null, dateOfBirth: "1955-01-01" },
  { id: LEGACY_FM_SPOUSE, role: "spouse", relationship: "other", firstName: "Sam", lastName: null, dateOfBirth: "1957-01-01" },
  { id: CHILD_A, role: "child", relationship: "child", firstName: "Alex", lastName: null, dateOfBirth: "1985-01-01" },
  { id: CHILD_B, role: "child", relationship: "child", firstName: "Bo", lastName: null, dateOfBirth: "1988-01-01" },
  { id: SARAH, role: "child", relationship: "child", firstName: "Sarah", lastName: null, dateOfBirth: "1990-01-01" },
];

const EXTERNALS = [{ id: CHARITY, name: "Red Cross", kind: "charity" as const }];

const PLAN_SETTINGS: PlanSettings = {
  flatFederalRate: 0,
  flatStateRate: 0,
  inflationRate: 0.025,
  planStartYear: 2026,
  planEndYear: 2080,
  estateAdminExpenses: 0,
  flatStateEstateRate: 0,
} as PlanSettings;

function account(
  id: string,
  category: Account["category"],
  value: number,
  owners: Account["owners"] = [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
  over: Partial<Account> = {},
): Account {
  return {
    id,
    name: id,
    category,
    subType: category === "cash" ? "checking" : category === "real_estate" ? "primary_residence" : "brokerage",
    value,
    basis: value,
    growthRate: 0,
    rmdEnabled: false,
    owners,
    ...over,
  } as Account;
}

const JOINT: Account["owners"] = [
  { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.5 },
  { kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 0.5 },
];

function person(recipientId: string, percentage = 100): WillBequestRecipient {
  return { recipientKind: "family_member", recipientId, percentage, sortOrder: 0 };
}

function dollars(recipient: Omit<WillBequestRecipient, "percentage" | "sortOrder" | "amount">, amount: number): WillBequestRecipient {
  return { ...recipient, percentage: 0, amount, sortOrder: 0 };
}

const BASE = {
  name: "gift",
  entityId: null,
  liabilityId: null,
  condition: "always" as const,
};

function estateDollarGift(recipients: WillBequestRecipient[]): Omit<WillBequest, "id" | "sortOrder"> {
  return {
    ...BASE, kind: "dollar", assetMode: null, accountId: null, percentage: 100,
    dollarSource: "estate", fallbackToEstate: false, recipients,
  };
}

function accountGift(
  accountId: string,
  recipients: WillBequestRecipient[],
  condition: WillBequest["condition"] = "always",
): Omit<WillBequest, "id" | "sortOrder"> {
  return { ...BASE, condition, kind: "asset", assetMode: "specific", accountId, percentage: 100, recipients };
}

/** A will whose gifts are paid in the order given. */
function will(
  gifts: Array<Omit<WillBequest, "id" | "sortOrder">>,
  residuaryRecipients: Will["residuaryRecipients"] = [],
): Will {
  return {
    id: "will-client",
    grantor: "client",
    bequests: gifts.map((g, i) => ({ ...g, id: `beq-${i}`, sortOrder: i })),
    residuaryRecipients,
  };
}

function mkInput(over: Partial<DeathEventInput> & { accounts: Account[] }): DeathEventInput {
  const { accounts, ...rest } = over;
  const accountBalances: Record<string, number> = {};
  const basisMap: Record<string, number> = {};
  for (const a of accounts) {
    accountBalances[a.id] = a.value;
    basisMap[a.id] = a.basis;
  }
  return {
    year: 2026,
    deceased: "client",
    survivor: "spouse",
    will: null,
    incomes: [],
    liabilities: [],
    familyMembers: FMS,
    externalBeneficiaries: EXTERNALS,
    entities: [],
    planSettings: PLAN_SETTINGS,
    gifts: [],
    annualExclusionsByYear: {},
    dsueReceived: 0,
    priorTaxableGifts: { client: 0, spouse: 0 },
    ...rest,
    accounts,
    accountBalances,
    basisMap,
  };
}

const sumTo = (r: DeathEventResult, recipientId: string, pred: (t: DeathEventResult["transfers"][number]) => boolean = () => true) =>
  r.transfers
    .filter((t) => t.recipientId === recipientId && t.amount > 0 && pred(t))
    .reduce((s, t) => s + t.amount, 0);

describe("death chains — will gifts paid in list order", () => {
  it("final death: house + $10k cash, $50k gift to a child pays $10k and leaves the house to the remainder estate", () => {
    const house = account("house", "real_estate", 500_000);
    const cash = account("cash", "cash", 10_000);
    const w = will(
      [estateDollarGift([dollars({ recipientKind: "family_member", recipientId: CHILD_A }, 50_000)])],
      [{ recipientKind: "family_member", recipientId: CHILD_B, tier: "contingent", percentage: 100, sortOrder: 0 }],
    );

    const result = applyFinalDeath(mkInput({ will: w, accounts: [house, cash] }));

    expect(sumTo(result, CHILD_A, (t) => t.via === "will")).toBeCloseTo(10_000, 6);
    const houseOut = result.transfers.filter((t) => t.sourceAccountId === "house");
    expect(houseOut).toHaveLength(1);
    expect(houseOut[0]).toMatchObject({ via: "will_residuary", recipientId: CHILD_B, amount: 500_000 });
  });

  it("final death: a $50k dollar gift to a charity (external beneficiary) raises charitableDeduction by 50_000", () => {
    const brokerage = account("brok", "taxable", 500_000);
    const residuary: Will["residuaryRecipients"] = [
      { recipientKind: "family_member", recipientId: CHILD_B, tier: "contingent", percentage: 100, sortOrder: 0 },
    ];
    const withGift = will(
      [estateDollarGift([dollars({ recipientKind: "external_beneficiary", recipientId: CHARITY }, 50_000)])],
      residuary,
    );

    const gift = applyFinalDeath(mkInput({ will: withGift, accounts: [brokerage] }));
    const none = applyFinalDeath(mkInput({ will: will([], residuary), accounts: [brokerage] }));

    expect(gift.estateTax.charitableDeduction - none.estateTax.charitableDeduction).toBeCloseTo(50_000, 6);
  });

  it("first death: a $50k dollar gift to the spouse adds 50_000 to maritalDeduction", () => {
    const brokerage = account("brok", "taxable", 500_000);
    const residuary: Will["residuaryRecipients"] = [
      { recipientKind: "family_member", recipientId: CHILD_A, tier: "primary", percentage: 100, sortOrder: 0 },
    ];
    const withGift = will(
      [estateDollarGift([dollars({ recipientKind: "spouse", recipientId: null }, 50_000)])],
      residuary,
    );

    const gift = applyFirstDeath(mkInput({ will: withGift, accounts: [brokerage] }));
    const none = applyFirstDeath(mkInput({ will: will([], residuary), accounts: [brokerage] }));

    expect(gift.estateTax.maritalDeduction - none.estateTax.maritalDeduction).toBeCloseTo(50_000, 6);
  });

  it("first death: all cash joint → the dollar gift pays nothing and does not throw", () => {
    // The joint cash passes to the survivor by titling before the list runs;
    // the decedent's own house is the only will-passing asset, and a dollar
    // gift never carves up a home.
    const jointCash = account("joint-cash", "cash", 200_000, JOINT);
    const house = account("house", "real_estate", 500_000);
    const w = will(
      [estateDollarGift([dollars({ recipientKind: "family_member", recipientId: CHILD_A }, 50_000)])],
      [{ recipientKind: "family_member", recipientId: CHILD_B, tier: "primary", percentage: 100, sortOrder: 0 }],
    );

    const result = applyFirstDeath(mkInput({ will: w, accounts: [jointCash, house] }));

    expect(result.transfers.filter((t) => t.via === "will" && t.amount > 0)).toEqual([]);
    expect(result.transfers.filter((t) => t.sourceAccountId === "house").map((t) => t.via)).toEqual(["will_residuary"]);
    expect(result.transfers.filter((t) => t.sourceAccountId === "joint-cash").map((t) => t.via)).toEqual(["titling"]);
  });

  it("list order flips Sarah's Schwab", () => {
    const schwab = account("schwab", "taxable", 200_000);
    const cash = account("cash", "cash", 100_000);
    const estate40k = estateDollarGift([dollars({ recipientKind: "family_member", recipientId: CHILD_B }, 40_000)]);
    const schwabToSarah = accountGift("schwab", [person(SARAH)]);
    const residuary: Will["residuaryRecipients"] = [
      { recipientKind: "family_member", recipientId: CHILD_A, tier: "contingent", percentage: 100, sortOrder: 0 },
    ];
    const run = (gifts: Array<Omit<WillBequest, "id" | "sortOrder">>) =>
      sumTo(applyFinalDeath(mkInput({ will: will(gifts, residuary), accounts: [schwab, cash] })), SARAH);

    const dollarFirst = run([estate40k, schwabToSarah]);
    const schwabFirst = run([schwabToSarah, estate40k]);

    // $40k pro-rata across $300k of cash + brokerage: $26,667 of it from Schwab.
    expect(dollarFirst).toBeCloseTo(200_000 - 40_000 * (2 / 3), 6);
    expect(dollarFirst).toBeLessThan(schwabFirst);
    expect(schwabFirst).toBeCloseTo(200_000, 6);
  });

  describe("regression: a will with one 100% specific gift per account produces identical output", () => {
    // Shaped like both wills with bequests on prod: one 100% gift of a single
    // account (if the spouse predeceased), plus a 3-recipient remainder estate.
    // Around it, the account shapes the chain routes differently: a 2-way
    // beneficiary designation, a mortgaged home, a part-trust-owned account
    // (entity slice), a top-level business and an heir's own account.
    const TRUST: EntitySummary = {
      id: "ent-trust",
      name: "Family Trust",
      entityType: "trust",
      isIrrevocable: true,
      isGrantor: false,
      includeInPortfolio: false,
      grantor: "client",
    } as EntitySummary;
    const accounts: Account[] = [
      account("checking", "cash", 60_000),
      account("ira", "retirement", 400_000, undefined, {
        subType: "traditional_ira",
        basis: 0,
        beneficiaries: [
          { id: "bene-a", tier: "primary", percentage: 50, familyMemberId: CHILD_A, sortOrder: 0 },
          { id: "bene-b", tier: "primary", percentage: 50, familyMemberId: CHILD_B, sortOrder: 1 },
        ],
      } as Partial<Account>),
      account("schwab", "taxable", 300_000, undefined, { basis: 120_000 }),
      account("house", "real_estate", 600_000, undefined, { basis: 250_000 }),
      account("mixed", "taxable", 100_000, [
        { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.8 },
        { kind: "entity", entityId: TRUST.id, percent: 0.2 },
      ]),
      account("biz", "business", 250_000, undefined, { subType: "llc", parentAccountId: null } as Partial<Account>),
      account("heir-acct", "taxable", 30_000, [{ kind: "family_member", familyMemberId: SARAH, percent: 1 }]),
    ];
    const mortgage: Liability = {
      id: "mortgage",
      name: "Mortgage",
      balance: 200_000,
      interestRate: 0.05,
      monthlyPayment: 1_500,
      startYear: 2010,
      startMonth: 1,
      termMonths: 360,
      linkedPropertyId: "house",
      extraPayments: [],
      owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
    };
    const residuary = (tier: "primary" | "contingent"): Will["residuaryRecipients"] => [
      { recipientKind: "family_member", recipientId: CHILD_A, tier, percentage: 40, sortOrder: 0 },
      { recipientKind: "family_member", recipientId: CHILD_B, tier, percentage: 30, sortOrder: 1 },
      { recipientKind: "external_beneficiary", recipientId: CHARITY, tier, percentage: 30, sortOrder: 2 },
    ];
    const prodShaped = (condition: WillBequest["condition"]): Will =>
      will([accountGift("schwab", [person(SARAH)], condition)], [...residuary("primary")!, ...residuary("contingent")!]);

    // Synthetic ids (`death-acct-7`) come from one process-wide counter, so
    // they're renamed by first appearance (`death-acct#3`). The ordered pass
    // runs every account's titling and designations before any will split, so
    // it numbers the same accounts differently; the ids are opaque keys and
    // nothing orders by them. Everything else must match exactly.
    const SYNTHETIC = /^(death-acct|death-liab-bequest|death-liab|entity-slice|liab-slice)-\d+$/;
    const canonicalIds = (value: unknown): unknown => {
      const named = new Map<string, string>();
      const counts = new Map<string, number>();
      const rename = (s: string): string => {
        const prefix = SYNTHETIC.exec(s)?.[1];
        if (prefix == null) return s;
        if (!named.has(s)) {
          const n = (counts.get(prefix) ?? 0) + 1;
          counts.set(prefix, n);
          named.set(s, `${prefix}#${n}`);
        }
        return named.get(s)!;
      };
      const walk = (v: unknown): unknown => {
        if (typeof v === "string") return rename(v);
        if (Array.isArray(v)) return v.map(walk);
        if (v != null && typeof v === "object") {
          return Object.fromEntries(Object.entries(v).map(([k, x]) => [rename(k), walk(x)]));
        }
        return v;
      };
      return walk(value);
    };
    const run = (apply: (i: DeathEventInput) => DeathEventResult, i: DeathEventInput) => {
      _resetSyntheticIdCounter();
      return canonicalIds(apply(i));
    };

    it("final death", () => {
      const result = run(applyFinalDeath, mkInput({
        year: 2045,
        will: prodShaped("if_spouse_predeceased"),
        accounts,
        liabilities: [mortgage],
        entities: [TRUST],
      }));
      expect(result).toMatchSnapshot();
    });

    it("first death", () => {
      const result = run(applyFirstDeath, mkInput({
        will: prodShaped("always"),
        accounts: [...accounts, account("joint-cash", "cash", 80_000, JOINT)],
        liabilities: [mortgage],
        entities: [TRUST],
      }));
      expect(result).toMatchSnapshot();
    });
  });
});
