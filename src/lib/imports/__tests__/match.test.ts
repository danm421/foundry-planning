import type { Table } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  annotatePayload,
  emptyCandidates,
  runMatchingPass,
  type MatchCandidates,
} from "../match";
import {
  emptyImportPayload,
  type Annotated,
  type ImportPayload,
  type MatchAnnotation,
} from "../types";
import type {
  ExtractedAccount,
  ExtractedDependent,
  ExtractedEntity,
  ExtractedExpense,
  ExtractedIncome,
  ExtractedLiability,
  ExtractedLifePolicy,
  ExtractedWill,
} from "@/lib/extraction/types";

// runMatchingPass loads living slots (both modes) and the full candidate set
// (updating mode) from the DB. Stub the select chain and dispatch on the table
// being queried so a test can seed real-shaped rows for the tables it cares
// about; every other table yields no rows, which is what the pure-annotation
// and onboarding tests want. `.innerJoin` is a no-op link in the chain because
// loadCandidates joins accounts for the life-policy and account-owner queries.
const dbRows = vi.hoisted(() => ({ byTable: {} as Record<string, unknown[]> }));

vi.mock("@/db", async () => {
  const { getTableName } = await import("drizzle-orm");
  return {
    db: {
      select: () => ({
        from: (table: Table) => {
          const rows = dbRows.byTable[getTableName(table)] ?? [];
          const chain = {
            innerJoin: () => chain,
            where: () => Promise.resolve(rows),
          };
          return chain;
        },
      }),
    },
  };
});

beforeEach(() => {
  dbRows.byTable = {};
});

function payloadFixture(overrides: Partial<ImportPayload> = {}): ImportPayload {
  return { ...emptyImportPayload(), ...overrides };
}

function annotated<T extends object>(row: T): Annotated<T> {
  return { ...row, match: { kind: "new" } };
}

/** Ranked candidate scores keyed by id, for asserting on relative scoring. */
function fuzzyScores(match: MatchAnnotation | undefined): Map<string, number> {
  if (match?.kind !== "fuzzy") {
    throw new Error(`expected a fuzzy match, got ${JSON.stringify(match)}`);
  }
  return new Map(match.candidates.map((c) => [c.id, c.score]));
}

/**
 * Two identical accounts differing only in who owns them. Any ownership signal
 * — real or fabricated — separates their scores; true neutrality leaves them
 * exactly equal.
 */
const HIS_AND_HERS: MatchCandidates["accounts"] = [
  {
    id: "his",
    name: "Fidelity IRA",
    category: "retirement",
    accountNumberLast4: null,
    custodian: "Fidelity",
    value: 100_000,
    ownerIds: ["fm-john"],
  },
  {
    id: "hers",
    name: "Fidelity IRA",
    category: "retirement",
    accountNumberLast4: null,
    custodian: "Fidelity",
    value: 100_000,
    ownerIds: ["fm-jane"],
  },
];

const SPOUSES: MatchCandidates["family"] = [
  { id: "fm-john", role: "client", firstName: "John", lastName: "Smith" },
  { id: "fm-jane", role: "spouse", firstName: "Jane", lastName: "Smith" },
];

describe("annotatePayload", () => {
  it("annotates each entity-array in parallel using the right match-key module", () => {
    const account: Annotated<ExtractedAccount> = annotated({
      name: "Schwab Brokerage",
      category: "taxable",
      accountNumberLast4: "1234",
      custodian: "Charles Schwab",
      value: 100_000,
    });
    const income: Annotated<ExtractedIncome> = annotated({
      type: "salary",
      name: "Acme Salary",
      owner: "client",
    });
    const expense: Annotated<ExtractedExpense> = annotated({
      type: "living",
      name: "Living Expenses",
    });
    const liability: Annotated<ExtractedLiability> = annotated({
      name: "Wells Fargo Mortgage",
      balance: 500_000,
    });
    const dependent: Annotated<ExtractedDependent> = annotated({
      firstName: "Anna",
      lastName: "Smith",
      dateOfBirth: "2010-05-04",
    });
    const policy: Annotated<ExtractedLifePolicy> = annotated({
      carrier: "MetLife",
      policyNumberLast4: "9999",
      insuredPerson: "client",
      policyType: "term",
      faceValue: 1_000_000,
      accountName: "MetLife Term",
    });
    const will: Annotated<ExtractedWill> = annotated({ grantor: "client", bequests: [] });
    const entity: Annotated<ExtractedEntity> = annotated({
      name: "Smith Family Trust",
      entityType: "trust",
    });

    const payload: ImportPayload = payloadFixture({
      accounts: [account],
      incomes: [income],
      expenses: [expense],
      liabilities: [liability],
      dependents: [dependent],
      lifePolicies: [policy],
      wills: [will],
      entities: [entity],
    });

    const candidates: MatchCandidates = {
      accounts: [
        {
          id: "acct-1",
          name: "Schwab Brokerage",
          category: "taxable",
          accountNumberLast4: "1234",
          custodian: "Charles Schwab",
          value: 100_000,
        },
      ],
      incomes: [{ id: "inc-1", type: "salary", name: "Acme Salary", owner: "client" }],
      expenses: [{ id: "exp-1", type: "living", name: "Living Expenses" }],
      liabilities: [{ id: "li-1", name: "Wells Fargo Mortgage", balance: 500_000 }],
      familyMembers: [
        { id: "fm-1", firstName: "Anna", lastName: "Smith", dateOfBirth: "2010-05-04" },
      ],
      lifePolicies: [
        {
          id: "lp-1",
          carrier: "MetLife",
          policyNumberLast4: "9999",
          insuredPerson: "client",
          policyType: "term",
          faceValue: 1_000_000,
        },
      ],
      wills: [{ id: "w-1", grantor: "client" }],
      entities: [{ id: "ent-1", name: "Smith Family Trust", entityType: "trust" }],
      livingSlots: [],
      family: [],
    };

    const result = annotatePayload(payload, candidates);

    expect(result.accounts[0].match).toEqual({ kind: "exact", existingId: "acct-1" });
    expect(result.incomes[0].match).toEqual({ kind: "exact", existingId: "inc-1" });
    expect(result.expenses[0].match).toEqual({ kind: "exact", existingId: "exp-1" });
    expect(result.liabilities[0].match).toEqual({ kind: "exact", existingId: "li-1" });
    expect(result.dependents[0].match).toEqual({ kind: "exact", existingId: "fm-1" });
    expect(result.lifePolicies[0].match).toEqual({ kind: "exact", existingId: "lp-1" });
    expect(result.wills[0].match).toEqual({ kind: "exact", existingId: "w-1" });
    expect(result.entities[0].match).toEqual({ kind: "exact", existingId: "ent-1" });
  });

  it("preserves singleton primary/spouse and warnings unchanged", () => {
    const payload: ImportPayload = payloadFixture({
      primary: { firstName: "Jordan" },
      spouse: { firstName: "Riley" },
      warnings: ["something to remember"],
    });
    const result = annotatePayload(payload, emptyCandidates());
    expect(result.primary).toEqual({ firstName: "Jordan" });
    expect(result.spouse).toEqual({ firstName: "Riley" });
    expect(result.warnings).toEqual(["something to remember"]);
  });

  it('falls back to { kind: "new" } when no candidates are available', () => {
    const payload: ImportPayload = payloadFixture({
      accounts: [
        annotated({
          name: "Apex Capital",
          category: "taxable",
          value: 10_000,
        }),
      ],
    });
    const result = annotatePayload(payload, emptyCandidates());
    expect(result.accounts[0].match).toEqual({ kind: "new" });
  });

  it("does not mutate the input payload", () => {
    const account = annotated({
      name: "Schwab",
      category: "taxable" as const,
      value: 1,
    });
    const payload: ImportPayload = payloadFixture({ accounts: [account] });
    annotatePayload(payload, emptyCandidates());
    expect(account.match).toEqual({ kind: "new" });
  });

  it("prefers the living-slot heuristic over matchExpense for living totals", () => {
    const candidates: MatchCandidates = {
      ...emptyCandidates(),
      expenses: [{ id: "exp-housing", type: "living", name: "Housing" }],
      livingSlots: [
        { id: "slot-current", name: "Current Living Expenses", role: "current" },
        { id: "slot-retirement", name: "Retirement Living Expenses", role: "retirement" },
      ],
    };
    const payload = payloadFixture({
      expenses: [
        annotated({ type: "living", name: "Living Expenses", annualAmount: 60000 }),
        annotated({ type: "living", name: "Retirement Expenses", annualAmount: 48000 }),
        annotated({ type: "living", name: "Housing", annualAmount: 24000 }),
      ] as Annotated<ExtractedExpense>[],
    });
    const result = annotatePayload(payload, candidates);
    expect(result.expenses[0].match).toEqual({ kind: "exact", existingId: "slot-current" });
    expect(result.expenses[1].match).toEqual({ kind: "exact", existingId: "slot-retirement" });
    expect(result.expenses[2].match).toEqual({ kind: "exact", existingId: "exp-housing" });
  });

  // Both rows read as the household's current-living total ("Total Monthly
  // Expenses" clears CURRENT_RE), so they are two extractions of ONE figure —
  // a $60k slot and a $61k re-read of the same household total, not a $60k
  // expense plus a separate $61k one. Row 1 must not commit: `new` would INSERT
  // a second living-expense row and double-count $61k/yr of spending forever.
  // `fuzzy` writes nothing and puts the disagreement in front of the advisor,
  // who is the only one who can say which figure is right.
  it("degrades a second row claiming the same living slot to fuzzy rather than inserting it", () => {
    const candidates: MatchCandidates = {
      ...emptyCandidates(),
      expenses: [],
      livingSlots: [
        { id: "slot-current", name: "Current Living Expenses", role: "current" },
        { id: "slot-retirement", name: "Retirement Living Expenses", role: "retirement" },
      ],
    };
    const payload = payloadFixture({
      expenses: [
        annotated({ type: "living", name: "Living Expenses", annualAmount: 60000 }),
        annotated({ type: "living", name: "Total Monthly Expenses", annualAmount: 61000 }),
      ] as Annotated<ExtractedExpense>[],
    });
    const result = annotatePayload(payload, candidates);
    expect(result.expenses[0].match).toEqual({ kind: "exact", existingId: "slot-current" });
    expect(result.expenses[1].match).toEqual({ kind: "fuzzy", candidates: [] });
  });

  it("resolves incoming owners from the registration hint and ranks by owner", () => {
    const payload = {
      ...emptyImportPayload(),
      accounts: [
        {
          name: "Fidelity IRA",
          category: "retirement" as const,
          value: 100_000,
          ownerNameHint: "Jane B Smith IRA",
        },
      ],
    };

    const result = annotatePayload(payload, {
      ...emptyCandidates(),
      family: [
        { id: "fm-john", role: "client", firstName: "John", lastName: "Smith" },
        { id: "fm-jane", role: "spouse", firstName: "Jane", lastName: "Smith" },
      ],
      accounts: [
        {
          id: "his",
          name: "Fidelity IRA",
          category: "retirement",
          accountNumberLast4: null,
          custodian: "Fidelity",
          value: 100_000,
          ownerIds: ["fm-john"],
        },
        {
          id: "hers",
          name: "Fidelity IRA",
          category: "retirement",
          accountNumberLast4: null,
          custodian: "Fidelity",
          value: 100_000,
          ownerIds: ["fm-jane"],
        },
      ],
    });

    const match = result.accounts[0].match;
    expect(match?.kind).toBe("fuzzy");
    if (match?.kind === "fuzzy") {
      expect(match.candidates[0].id).toBe("hers");
    }
  });

  // The registration parser is shared with the commit step, which must always
  // write *somebody* as the owner and so falls back to the client. As matching
  // evidence that fallback is a fabrication: it scores client-owned candidates
  // 1.0 and spouse-owned ones 0.0 on a signal the document never carried.
  it("scores ownership neutrally when the account carries no registration evidence", () => {
    const result = annotatePayload(
      payloadFixture({
        accounts: [annotated({ name: "Fidelity IRA", category: "retirement", value: 100_000 })],
      }),
      { ...emptyCandidates(), family: SPOUSES, accounts: HIS_AND_HERS },
    );

    const scores = fuzzyScores(result.accounts[0].match);
    expect([...scores.keys()].sort()).toEqual(["hers", "his"]);
    expect(scores.get("hers")).toBe(scores.get("his"));
  });

  it("scores ownership neutrally when the registration hint names nobody on the roster", () => {
    const result = annotatePayload(
      payloadFixture({
        accounts: [
          annotated({
            name: "Fidelity IRA",
            category: "retirement",
            value: 100_000,
            // An entity registration: matches no family member's first name
            // and carries no joint cue, so the parser degrades to the client.
            ownerNameHint: "Smith Family Trust",
          }),
        ],
      }),
      { ...emptyCandidates(), family: SPOUSES, accounts: HIS_AND_HERS },
    );

    const scores = fuzzyScores(result.accounts[0].match);
    expect([...scores.keys()].sort()).toEqual(["hers", "his"]);
    expect(scores.get("hers")).toBe(scores.get("his"));
  });

  // The user-visible harm, not just the mechanism: SCORE_FLOOR is documented as
  // calibrated to keep renamed accounts in the picker. Neutral ownership puts
  // this candidate at 0.45*(2/3) + 0.25*0.5 + 0 + 0.1*0.769 = 0.502, just over
  // the 0.45 floor. Fabricated client ownership zeroes the owner term -> 0.377,
  // and the advisor's real account vanishes and gets duplicated.
  it("keeps a renamed spouse-owned account above SCORE_FLOOR when ownership is unknown", () => {
    const result = annotatePayload(
      payloadFixture({
        accounts: [
          annotated({ name: "Fidelity IRA", category: "taxable", value: 130_000 }),
        ],
      }),
      {
        ...emptyCandidates(),
        family: SPOUSES,
        accounts: [
          {
            id: "renamed",
            name: "Fidelity Rollover IRA",
            category: "retirement",
            accountNumberLast4: null,
            custodian: "Fidelity",
            value: 100_000,
            ownerIds: ["fm-jane"],
          },
        ],
      },
    );

    expect(fuzzyScores(result.accounts[0].match).has("renamed")).toBe(true);
  });

  it("lets only the first row claim an existing account", () => {
    const candidate: MatchCandidates["accounts"][number] = {
      id: "acct-1",
      name: "Fidelity Rollover IRA",
      category: "retirement",
      accountNumberLast4: "1234",
      custodian: "Fidelity",
      value: 100_000,
    };
    const row = {
      name: "Fidelity Rollover IRA",
      category: "retirement" as const,
      accountNumberLast4: "1234",
      custodian: "Fidelity",
      value: 100_000,
    };

    const result = annotatePayload(
      payloadFixture({ accounts: [annotated(row), annotated(row)] }),
      { ...emptyCandidates(), accounts: [candidate] },
    );

    expect(result.accounts[0].match).toEqual({ kind: "exact", existingId: "acct-1" });
    expect(result.accounts[1].match?.kind).not.toBe("exact");
  });

  // What the blocked row degrades TO, asserted concretely rather than as
  // `not.toBe("exact")` — which is what let the `new` fallthrough ship. The
  // commit layer INSERTs on `new`, and the merge step pushes every uploaded
  // file's rows into one payload with no cross-file dedupe, so the same account
  // extracted from two overlapping statements would become two accounts and
  // double-count net worth silently. Every commit module skips `fuzzy`, so the
  // degraded row writes nothing, shows "Ambiguous" in the wizard, and lands in
  // `result.skipped` where the advisor can see it.
  it("degrades a row whose only exact match is already claimed to fuzzy, not new", () => {
    const candidate: MatchCandidates["accounts"][number] = {
      id: "acct-1",
      name: "Fidelity Rollover IRA",
      category: "retirement",
      accountNumberLast4: "1234",
      custodian: "Fidelity",
      value: 100_000,
    };
    const row = {
      name: "Fidelity Rollover IRA",
      category: "retirement" as const,
      accountNumberLast4: "1234",
      custodian: "Fidelity",
      value: 100_000,
    };

    const result = annotatePayload(
      payloadFixture({ accounts: [annotated(row), annotated(row)] }),
      { ...emptyCandidates(), accounts: [candidate] },
    );

    expect(result.accounts[0].match).toEqual({ kind: "exact", existingId: "acct-1" });
    expect(result.accounts[1].match).toEqual({ kind: "fuzzy", candidates: [] });
  });

  // The other half of the degrade: it must fire only when the row's own exact
  // match was taken, never merely because some earlier row claimed something.
  // Without this a blanket "fuzzy whenever anything is claimed" passes the test
  // above while burying every genuinely new account behind an ambiguity warning.
  it("leaves a row that matches nothing in the full candidate set as new", () => {
    const result = annotatePayload(
      payloadFixture({
        accounts: [
          annotated({
            name: "Fidelity Rollover IRA",
            category: "retirement",
            accountNumberLast4: "1234",
            custodian: "Fidelity",
            value: 100_000,
          }),
          annotated({ name: "Apex Capital", category: "taxable", value: 10_000 }),
        ],
      }),
      {
        ...emptyCandidates(),
        accounts: [
          {
            id: "acct-1",
            name: "Fidelity Rollover IRA",
            category: "retirement",
            accountNumberLast4: "1234",
            custodian: "Fidelity",
            value: 100_000,
          },
        ],
      },
    );

    expect(result.accounts[0].match).toEqual({ kind: "exact", existingId: "acct-1" });
    expect(result.accounts[1].match).toEqual({ kind: "new" });
  });

  // The expenses half of the same degrade, and the half a naive implementation
  // misses: `annotateExpenses` consults the claimed SET directly in its slot
  // branch rather than the filtered `available` list, so re-running it against
  // the unfiltered candidate list alone still returns the post-claim answer.
  // Note `candidates.expenses` is empty here — the onboarding shape, where the
  // slot is reachable through no other pool.
  it("degrades a second row that resolves to an already-claimed living slot to fuzzy", () => {
    const result = annotatePayload(
      payloadFixture({
        expenses: [
          annotated({ type: "living", name: "Total Expenses", annualAmount: 72_000 }),
          annotated({ type: "living", name: "Household Budget", annualAmount: 73_000 }),
        ] as Annotated<ExtractedExpense>[],
      }),
      {
        ...emptyCandidates(),
        livingSlots: [
          { id: "slot-current", name: "Current Living Expenses", role: "current" },
        ],
      },
    );

    expect(result.expenses[0].match).toEqual({ kind: "exact", existingId: "slot-current" });
    expect(result.expenses[1].match).toEqual({ kind: "fuzzy", candidates: [] });
  });

  it("keeps the living-expense slot guard intact", () => {
    const result = annotatePayload(
      payloadFixture({
        expenses: [
          annotated({ type: "living", name: "Living Expenses", annualAmount: 100_000 }),
          annotated({ type: "living", name: "Living Expenses", annualAmount: 90_000 }),
        ] as Annotated<ExtractedExpense>[],
      }),
      {
        ...emptyCandidates(),
        livingSlots: [{ id: "slot-current", name: "Current Living Expenses", role: "current" }],
      },
    );

    expect(result.expenses[0].match).toEqual({ kind: "exact", existingId: "slot-current" });
    expect(result.expenses[1].match?.kind).not.toBe("exact");
  });

  // Slots are expense rows, so a slot id reaches annotatePayload through BOTH
  // candidate pools: loadLivingSlots selects from `expenses`, and loadCandidates
  // selects every expense for the scenario with no isDefault filter. Tracking
  // slot claims in a set separate from the generic pool's therefore lets one
  // slot be claimed twice — reachable as soon as an advisor renames a default
  // slot away from matchLivingSlot's patterns ("Household Spending" fails
  // CURRENT_RE), because the renamed row then matches by exact name+type
  // through matchExpense while a later "Living Expenses" row still matches the
  // same slot by role. At commit that is two UPDATEs against one record —
  // last-wins — which is exactly what claimOnce exists to prevent.
  it("does not let one renamed slot be claimed by both the expense and slot matchers", () => {
    const renamedSlot = { id: "slot-current", name: "Household Spending" };
    const result = annotatePayload(
      payloadFixture({
        expenses: [
          annotated({ type: "living", name: "Household Spending", annualAmount: 100_000 }),
          annotated({ type: "living", name: "Living Expenses", annualAmount: 90_000 }),
        ] as Annotated<ExtractedExpense>[],
      }),
      {
        ...emptyCandidates(),
        expenses: [{ ...renamedSlot, type: "living" }],
        livingSlots: [{ ...renamedSlot, role: "current" }],
      },
    );

    expect(result.expenses[0].match).toEqual({ kind: "exact", existingId: "slot-current" });
    expect(result.expenses[1].match?.kind).not.toBe("exact");
  });
});

describe("runMatchingPass — onboarding mode", () => {
  it("annotates via living-slot pass (no DB slots) and leaves other rows new", async () => {
    const payload: ImportPayload = payloadFixture({
      accounts: [
        annotated({
          name: "Schwab Brokerage",
          category: "taxable",
          accountNumberLast4: "1234",
          custodian: "Charles Schwab",
          value: 100_000,
        }),
      ],
      expenses: [annotated({ type: "living", name: "Housing", annualAmount: 24000 })],
    });
    const result = await runMatchingPass({
      payload,
      clientId: "client-1",
      scenarioId: "",
      mode: "onboarding",
    });
    expect(result.accounts[0].match).toEqual({ kind: "new" });
    expect(result.expenses[0].match).toEqual({ kind: "new" });
    expect(result.expenseSlots).toEqual([]);
  });
});

describe("runMatchingPass — updating mode", () => {
  // Pins the *projection* loadCandidates builds, not just annotatePayload's use
  // of it: if the `ownerIds` line is dropped from the accounts mapping, every
  // candidate scores a neutral 0.5 on ownership, the two same-named IRAs tie,
  // and both assertions below go red. Without this the owner ladder can be
  // wired at the call site alone and be inert in production with tests green.
  it("loads account owners into the candidate set so ownership breaks a name tie", async () => {
    dbRows.byTable = {
      accounts: [
        {
          id: "his",
          name: "Fidelity IRA",
          category: "retirement",
          accountNumberLast4: null,
          custodian: "Fidelity",
          value: "100000",
        },
        {
          id: "hers",
          name: "Fidelity IRA",
          category: "retirement",
          accountNumberLast4: null,
          custodian: "Fidelity",
          value: "100000",
        },
      ],
      family_members: [
        {
          id: "fm-john",
          role: "client",
          firstName: "John",
          lastName: "Smith",
          dateOfBirth: null,
        },
        {
          id: "fm-jane",
          role: "spouse",
          firstName: "Jane",
          lastName: "Smith",
          dateOfBirth: null,
        },
      ],
      account_owners: [
        { accountId: "his", familyMemberId: "fm-john" },
        { accountId: "hers", familyMemberId: "fm-jane" },
        // Entity-owned row: no family member, contributes nothing.
        { accountId: "hers", familyMemberId: null },
      ],
    };

    const result = await runMatchingPass({
      payload: payloadFixture({
        accounts: [
          annotated({
            name: "Fidelity IRA",
            category: "retirement",
            value: 100_000,
            ownerNameHint: "Jane B Smith IRA",
          }),
        ],
      }),
      clientId: "client-1",
      scenarioId: "scenario-1",
      mode: "updating",
    });

    const match = result.accounts[0].match;
    expect(match?.kind).toBe("fuzzy");
    if (match?.kind === "fuzzy") {
      expect(match.candidates.map((c) => c.id)).toEqual(["hers", "his"]);
      // Strictly greater, not merely first: a tie would leave the order to
      // sort stability rather than to ownership.
      expect(match.candidates[0].score).toBeGreaterThan(match.candidates[1].score);
    }
  });
});
