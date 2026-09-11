import { describe, it, expect } from "vitest";
import { and, eq, getTableName } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import {
  accounts,
  entities,
  familyMembers,
  incomes,
  planSettings,
  gifts,
  expenseDedicatedAccounts,
  savingsRules,
  savingsRuleSalaryIncomes,
  clientTaxAdjustments,
} from "@/db/schema";
import { executeBaseWritePlan } from "../execute-base-write-plan";
import type { BaseWritePlan } from "../promote-to-base-types";

// Minimal fake tx capturing operations. The real drizzle tables are passed
// through so getTableColumns() (used by the executor for scoping) works.
// Inserts return sequential ids (db-1, db-2, …) so idRemap wiring is
// observable; updates report `updateMatches` as their matched rows.
//
// The WHERE predicate is CAPTURED, not discarded. It is the only evidence that
// a statement is tenant-scoped, and the DB-backed tests that would otherwise
// prove it are gated behind `describe.skipIf(!HAS_DB)` — a fresh worktree has
// no `.env.local`, so on such a checkout they do not run at all. Without this
// capture, rewriting a scoped UPDATE as a bare `onConflictDoUpdate` would leave
// every runnable test green.
function makeTx(updateMatches: { id: string }[] = [{ id: "matched" }]) {
  const ops: { op: string; table: unknown; arg: unknown; where?: unknown }[] = [];
  let seq = 0;
  const tx = {
    insert: (table: unknown) => ({
      values: (arg: unknown) => {
        ops.push({ op: "insert", table, arg });
        return { returning: async () => [{ id: `db-${++seq}` }] };
      },
    }),
    update: (table: unknown) => ({
      set: (arg: unknown) => ({
        where: (predicate: unknown) => {
          ops.push({ op: "update", table, arg, where: predicate });
          return { returning: async () => updateMatches };
        },
      }),
    }),
    delete: (table: unknown) => ({
      where: async (predicate: unknown) => {
        ops.push({ op: "delete", table, arg: null, where: predicate });
      },
    }),
  };
  return { tx, ops };
}

const emptyPlan = (): BaseWritePlan => ({
  inserts: [],
  updates: [],
  singletonUpdates: [],
  removes: [],
});

describe("executeBaseWritePlan", () => {
  it("inserts an add row scoped to the base scenario and remaps the synthetic id", async () => {
    const plan: BaseWritePlan = {
      ...emptyPlan(),
      inserts: [
        {
          kind: "income",
          targetId: "synthetic",
          raw: { id: "synthetic", name: "Rental", type: "other", annualAmount: 9000 },
        },
      ],
    };
    const { tx, ops } = makeTx();
    const counts = await executeBaseWritePlan(tx as never, plan, {
      clientId: "c1",
      baseScenarioId: "base1",
    });
    const insert = ops.find((o) => o.op === "insert");
    const arg = insert!.arg as Record<string, unknown>;
    expect(insert!.table).toBe(incomes);
    expect(arg.clientId).toBe("c1");
    expect(arg.scenarioId).toBe("base1");
    expect(arg.annualAmount).toBe("9000"); // numeric column coerced to string
    expect("id" in arg).toBe(false); // synthetic id stripped so the DB generates one
    expect(counts.income).toBe(1);
  });

  it("inserts a client_tax_adjustment row with withheldMode and withheldValue preserved", async () => {
    // client_tax_adjustment is the mirror image of client_deduction, but with
    // withheldMode/withheldValue columns a deduction doesn't have. Asserting
    // on them (not just that the row lands) catches a promote registered
    // against the wrong table — coerceForTable silently drops any raw key
    // that isn't a real column on the table it's given, so a registry mixup
    // (e.g. pointing at clientDeductions) would make these two go missing
    // rather than error.
    const plan: BaseWritePlan = {
      ...emptyPlan(),
      inserts: [
        {
          kind: "client_tax_adjustment",
          targetId: "synthetic",
          raw: {
            id: "synthetic",
            name: "Roth conversion already done",
            annualAmount: 40000,
            withheldMode: "percent",
            withheldValue: 0.22,
          },
        },
      ],
    };
    const { tx, ops } = makeTx();
    const counts = await executeBaseWritePlan(tx as never, plan, {
      clientId: "c1",
      baseScenarioId: "base1",
    });
    const insert = ops.find((o) => o.op === "insert");
    const arg = insert!.arg as Record<string, unknown>;
    expect(insert!.table).toBe(clientTaxAdjustments);
    expect(arg.clientId).toBe("c1");
    expect(arg.scenarioId).toBe("base1");
    expect(arg.annualAmount).toBe("40000"); // numeric column coerced to string
    expect(arg.withheldMode).toBe("percent"); // enum column passes through untouched
    expect(arg.withheldValue).toBe("0.22"); // numeric column coerced to string
    expect(counts.client_tax_adjustment).toBe(1);
  });

  it("does NOT inject scenarioId for the client-scoped gifts table", async () => {
    const plan: BaseWritePlan = {
      ...emptyPlan(),
      inserts: [
        { kind: "gift", targetId: "g-syn", raw: { id: "g-syn", year: 2030, amount: 5000 } },
      ],
    };
    // gift is the one kind that preserves the change's id, so it upserts: a
    // scoped UPDATE first, falling through to an INSERT when nothing matched.
    // No base row here, so this is the insert branch.
    const { tx, ops } = makeTx([]);
    await executeBaseWritePlan(tx as never, plan, { clientId: "c1", baseScenarioId: "base1" });
    const insert = ops.find((o) => o.op === "insert")!;
    const arg = insert.arg as Record<string, unknown>;
    expect(insert.table).toBe(gifts);
    expect(arg.clientId).toBe("c1"); // gifts is client-scoped
    expect("scenarioId" in arg).toBe(false); // gifts has no scenarioId column
    expect(arg.id).toBe("g-syn"); // …and keeps the id the change names
  });

  it("updates an existing gift in place rather than inserting a second copy", async () => {
    // A gift has no `edit` op, so editing a base gift is written as an `add` on
    // that gift's OWN id. Minting a fresh uuid left the original row sitting
    // beside the new one — one promote, two gifts.
    const plan: BaseWritePlan = {
      ...emptyPlan(),
      inserts: [
        { kind: "gift", targetId: "g-base", raw: { id: "g-base", year: 2030, amount: 5000 } },
      ],
    };
    const { tx, ops } = makeTx([{ id: "g-base" }]); // the base gift exists
    const counts = await executeBaseWritePlan(tx as never, plan, {
      clientId: "c1",
      baseScenarioId: "base1",
    });
    expect(ops.filter((o) => o.op === "insert")).toHaveLength(0);
    const update = ops.find((o) => o.op === "update")!;
    expect(update.table).toBe(gifts);
    const arg = update.arg as Record<string, unknown>;
    expect("id" in arg).toBe(false); // the id is the WHERE clause, never the SET
    expect(arg.amount).toBe("5000");
    expect(arg.updatedAt).toBeInstanceOf(Date);
    expect(counts.gift).toBe(1);
  });

  // THE CROSS-TENANT GUARD. Preserving the gift's id means promote UPDATEs by
  // id, so the scoping of that predicate is the only thing standing between a
  // promote and another client's row. This test runs with NO database, which is
  // the point: the real-DB proof lives in promote-gift.test.ts behind
  // `skipIf(!HAS_DB)` and is silently absent on a fresh worktree.
  it("scopes the gift UPDATE to the promoting client, keyed by the change's targetId", async () => {
    const plan: BaseWritePlan = {
      ...emptyPlan(),
      inserts: [
        {
          kind: "gift",
          targetId: "g-target",
          // The payload's own `id` deliberately DISAGREES with targetId.
          // `desiredFields` is unconstrained and is merged straight into the add
          // payload (changes-writer.ts:219-236), so a change targeting gift
          // g-target can genuinely carry `{id: g-payload}` — and promote must
          // still write the gift the change TARGETS, which is the one the
          // overlay stripped.
          raw: { id: "g-payload", year: 2030, amount: 5000 },
        },
      ],
    };
    const { tx, ops } = makeTx([{ id: "g-target" }]);
    await executeBaseWritePlan(tx as never, plan, { clientId: "c1", baseScenarioId: "base1" });

    const update = ops.find((o) => o.op === "update")!;
    expect(update.table).toBe(gifts);
    // Spelled out rather than compared against the helper's own output, so the
    // clientId term is asserted concretely. Fails if anyone drops the client
    // scoping, keys off the payload id, or swaps the whole thing for an
    // unscoped upsert (which records no update op at all).
    expect(update.where).toEqual(and(eq(gifts.id, "g-target"), eq(gifts.clientId, "c1")));
  });

  it("inserts accounts before other kinds (FK-safe ordering)", async () => {
    const plan: BaseWritePlan = {
      ...emptyPlan(),
      inserts: [
        { kind: "income", targetId: "i1", raw: { id: "i1", name: "x" } },
        { kind: "account", targetId: "a1", raw: { id: "a1", name: "Brokerage" } },
      ],
    };
    const { tx, ops } = makeTx();
    await executeBaseWritePlan(tx as never, plan, { clientId: "c1", baseScenarioId: "base1" });
    expect(ops[0].table).toBe(accounts);
    expect(ops[1].table).toBe(incomes);
  });

  it("inserts incomes before the rows that FK to them (savings-rule salary basis)", async () => {
    // savings_rule_salary_incomes.income_id FKs to incomes.id, and the child
    // writer resolves synthetic ids through idRemap — which is only populated
    // once the income row itself has been inserted. Without incomes ranked
    // ahead of savings rules the writer would emit the raw synthetic id and
    // the FK would reject an otherwise legal promotion.
    const plan: BaseWritePlan = {
      ...emptyPlan(),
      inserts: [
        {
          kind: "savings_rule",
          targetId: "s1",
          raw: { id: "s1", accountId: "a-syn", salaryIncomeIds: ["i-syn"] },
        },
        { kind: "income", targetId: "i-syn", raw: { id: "i-syn", name: "Salary" } },
        { kind: "account", targetId: "a-syn", raw: { id: "a-syn", name: "401(k)" } },
      ],
    };
    const { tx, ops } = makeTx();
    await executeBaseWritePlan(tx as never, plan, { clientId: "c1", baseScenarioId: "base1" });
    const insertTables = ops.filter((o) => o.op === "insert").map((o) => o.table);
    expect(insertTables).toEqual([
      accounts,
      incomes,
      savingsRules,
      savingsRuleSalaryIncomes,
    ]);
    // db-1 = account, db-2 = income, db-3 = savings rule
    const joinInsert = ops.find(
      (o) => o.op === "insert" && o.table === savingsRuleSalaryIncomes,
    )!;
    expect(joinInsert.arg).toEqual([
      { savingsRuleId: "db-3", incomeId: "db-2", sortOrder: 0 },
    ]);
  });

  it("inserts a gift's recipient kinds, and family members, ahead of the rows that FK to them", async () => {
    // THE DEFECT. A scenario that creates a trust and gifts to it could never be
    // promoted. The old ranking was `account 0, income 1, everything else 2`, so
    // `entity` and `gift` shared a bucket and Postgres row order decided which
    // insert went first — and it also ranked `account` AHEAD of the
    // `family_member` its grantor/beneficiary columns FK to.
    //
    // The ranking is derived from the FK graph in src/db/schema.ts:
    // `entities`, `family_members` and `external_beneficiaries` have no outgoing
    // FK to any other promotable kind; `accounts` FKs to `family_members`;
    // `gifts` FKs to entities/family_members/external_beneficiaries/accounts.
    const plan: BaseWritePlan = {
      ...emptyPlan(),
      inserts: [
        {
          kind: "gift",
          targetId: "g1",
          raw: { id: "g1", year: 2030, amount: 5000, recipientEntityId: "e-syn" },
        },
        {
          kind: "account",
          targetId: "a1",
          raw: { id: "a1", name: "Emma 529", grantorFamilyMemberId: "fm-syn" },
        },
        { kind: "family_member", targetId: "fm-syn", raw: { id: "fm-syn", firstName: "Emma" } },
        {
          kind: "entity",
          targetId: "e-syn",
          raw: { id: "e-syn", name: "2030 Family Trust", entityType: "trust" },
        },
      ],
    };
    // `gift` preserves the change's id, so it upserts: no base row here means the
    // scoped UPDATE misses and it falls through to an INSERT.
    const { tx, ops } = makeTx([]);
    await executeBaseWritePlan(tx as never, plan, { clientId: "c1", baseScenarioId: "base1" });

    // Compared by table NAME: a failed `toEqual` on drizzle table objects prints
    // thousands of lines of column metadata and hides which order actually ran.
    const insertTables = ops
      .filter((o) => o.op === "insert")
      .map((o) => getTableName(o.table as PgTable));
    // Rank 0 holds family_member and entity, and Array#sort is stable, so the
    // two keep the plan's own relative order inside that rank.
    expect(insertTables).toEqual([
      getTableName(familyMembers),
      getTableName(entities),
      getTableName(accounts),
      getTableName(gifts),
    ]);
  });

  it("remaps a gift DRAFT's recipient, which only becomes a column once translated", async () => {
    // The second half of the same defect: `remapRefs` used to run BEFORE
    // `entry.translate`. A gift change's payload is an EstateFlowGift DRAFT
    // whose recipient is NESTED (`recipient: {kind, id}`), and it only becomes a
    // flat `recipientEntityId` once the translator has run — so a remap that
    // fired first could never see it, and the synthetic entity id went straight
    // into the FK column.
    const plan: BaseWritePlan = {
      ...emptyPlan(),
      inserts: [
        {
          kind: "entity",
          targetId: "e-syn",
          raw: { id: "e-syn", name: "2030 Family Trust", entityType: "trust" },
        },
        {
          kind: "gift",
          targetId: "g1",
          raw: {
            id: "g1",
            kind: "cash-once",
            year: 2030,
            amount: 50_000,
            grantor: "client",
            recipient: { kind: "entity", id: "e-syn" },
            crummey: false,
          },
        },
      ],
    };
    const { tx, ops } = makeTx([]);
    await executeBaseWritePlan(tx as never, plan, { clientId: "c1", baseScenarioId: "base1" });

    const giftInsert = ops.find((o) => o.op === "insert" && o.table === gifts)!;
    const arg = giftInsert.arg as Record<string, unknown>;
    expect(arg.recipientEntityId).toBe("db-1"); // the entity's generated id…
    expect(arg.recipientEntityId).not.toBe("e-syn"); // …not the synthetic one
    // The translation itself still ran — a remap that ate it would be worse.
    expect(arg.amount).toBe("50000");
    expect(arg.useCrummeyPowers).toBe(false);
  });

  it("remaps only ref ids added in this same batch and leaves every other id alone", async () => {
    // INERTNESS. `REF_COLUMNS` grew to every FK column pointing at another
    // promotable kind, so the "unchanged for every other kind" claim has to be a
    // measured fact: a column only ever rewrites a value that IS a synthetic
    // targetId inserted in the same batch. A base-plan entity id must survive
    // untouched, or promotion would re-point live rows at the wrong parent.
    const plan: BaseWritePlan = {
      ...emptyPlan(),
      inserts: [
        {
          kind: "entity",
          targetId: "e-syn",
          raw: { id: "e-syn", name: "2030 Family Trust", entityType: "trust" },
        },
        {
          kind: "income",
          targetId: "i1",
          raw: { id: "i1", name: "Trust distribution", ownerEntityId: "e-syn" },
        },
        {
          kind: "income",
          targetId: "i2",
          raw: { id: "i2", name: "Rental", ownerEntityId: "e-already-in-the-base-plan" },
        },
      ],
    };
    const { tx, ops } = makeTx();
    await executeBaseWritePlan(tx as never, plan, { clientId: "c1", baseScenarioId: "base1" });

    const incomeArgs = ops
      .filter((o) => o.op === "insert" && o.table === incomes)
      .map((o) => o.arg as Record<string, unknown>);
    expect(incomeArgs).toHaveLength(2);
    expect(incomeArgs[0].ownerEntityId).toBe("db-1"); // in-batch → remapped
    expect(incomeArgs[1].ownerEntityId).toBe("e-already-in-the-base-plan"); // untouched
  });

  it("updates a base row with a scoped set carrying updatedAt", async () => {
    const plan: BaseWritePlan = {
      ...emptyPlan(),
      updates: [{ kind: "account", id: "a1", set: { value: 250 } }],
    };
    const { tx, ops } = makeTx();
    const counts = await executeBaseWritePlan(tx as never, plan, {
      clientId: "c1",
      baseScenarioId: "base1",
    });
    const update = ops.find((o) => o.op === "update")!;
    const arg = update.arg as Record<string, unknown>;
    expect(update.table).toBe(accounts);
    expect(arg.value).toBe("250"); // numeric coerced
    expect(arg.updatedAt).toBeInstanceOf(Date);
    expect(counts.account).toBe(1);
  });

  it("routes a plan_settings singleton edit to the planSettings table", async () => {
    const plan: BaseWritePlan = {
      ...emptyPlan(),
      singletonUpdates: [{ kind: "plan_settings", set: { inflationRate: 0.025 } }],
    };
    const { tx, ops } = makeTx();
    const counts = await executeBaseWritePlan(tx as never, plan, {
      clientId: "c1",
      baseScenarioId: "base1",
    });
    const update = ops.find((o) => o.op === "update")!;
    expect(update.table).toBe(planSettings);
    expect(counts.plan_settings).toBe(1);
  });

  it("remaps same-batch synthetic account ids inside an expense's dedicated rows", async () => {
    const plan: BaseWritePlan = {
      ...emptyPlan(),
      inserts: [
        {
          kind: "expense",
          targetId: "syn-exp",
          raw: {
            id: "syn-exp",
            name: "College",
            type: "education",
            annualAmount: 30000,
            dedicatedAccountIds: ["syn-529"],
          },
        },
        { kind: "account", targetId: "syn-529", raw: { id: "syn-529", name: "529 Emma" } },
      ],
    };
    const { tx, ops } = makeTx();
    await executeBaseWritePlan(tx as never, plan, { clientId: "c1", baseScenarioId: "base1" });
    // account sorted first → db-1; expense → db-2
    const joinInsert = ops.find(
      (o) => o.op === "insert" && o.table === expenseDedicatedAccounts,
    );
    expect(joinInsert).toBeTruthy();
    expect(joinInsert!.arg as Record<string, unknown>).toMatchObject({
      expenseId: "db-2",
      accountId: "db-1",
      sortOrder: 0,
    });
  });

  it("rewrites dedicated rows via the expense childUpdater on a matched update", async () => {
    const plan: BaseWritePlan = {
      ...emptyPlan(),
      updates: [
        { kind: "expense", id: "e1", set: { annualAmount: 20000, dedicatedAccountIds: ["acct-9"] } },
      ],
    };
    const { tx, ops } = makeTx([{ id: "e1" }]);
    const counts = await executeBaseWritePlan(tx as never, plan, {
      clientId: "c1",
      baseScenarioId: "base1",
    });
    expect(counts.expense).toBe(1);
    const del = ops.find((o) => o.op === "delete" && o.table === expenseDedicatedAccounts);
    expect(del).toBeTruthy();
    const ins = ops.find((o) => o.op === "insert" && o.table === expenseDedicatedAccounts);
    expect(ins!.arg as Record<string, unknown>).toMatchObject({
      expenseId: "e1",
      accountId: "acct-9",
      sortOrder: 0,
    });
  });

  it("skips the childUpdater when the update matched no base row", async () => {
    const plan: BaseWritePlan = {
      ...emptyPlan(),
      updates: [{ kind: "expense", id: "ghost", set: { dedicatedAccountIds: ["acct-9"] } }],
    };
    const { tx, ops } = makeTx([]); // update matches nothing
    await executeBaseWritePlan(tx as never, plan, { clientId: "c1", baseScenarioId: "base1" });
    expect(ops.filter((o) => o.table === expenseDedicatedAccounts)).toHaveLength(0);
  });

  it("emits a scoped delete for a remove", async () => {
    const plan: BaseWritePlan = {
      ...emptyPlan(),
      removes: [{ kind: "account", id: "a1", cascade: false }],
    };
    const { tx, ops } = makeTx();
    const counts = await executeBaseWritePlan(tx as never, plan, {
      clientId: "c1",
      baseScenarioId: "base1",
    });
    expect(ops.find((o) => o.op === "delete")!.table).toBe(accounts);
    expect(counts["account.remove"]).toBe(1);
  });
});
