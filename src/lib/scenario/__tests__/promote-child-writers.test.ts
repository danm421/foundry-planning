// src/lib/scenario/__tests__/promote-child-writers.test.ts
import { describe, it, expect } from "vitest";
import {
  expenseDedicatedAccounts,
  extraPayments,
  liabilityOwners,
  savingsRuleSalaryIncomes,
  willBequests,
  willResiduaryRecipients,
} from "@/db/schema";
import {
  writeAccountChildren,
  writeLiabilityChildren,
  writeIncomeChildren,
  writeExpenseChildren,
  updateExpenseChildren,
  writeSavingsRuleChildren,
  updateSavingsRuleChildren,
  writeTransferChildren,
  writeRothConversionChildren,
  writeReinvestmentChildren,
  writeWillChildren,
  updateWillChildren,
  updateLiabilityChildren,
} from "../promote-child-writers";

// Minimal fake tx that records insert + delete operations.
function makeTx(returnedId?: string) {
  const inserted: { table: unknown; values: unknown }[] = [];
  const deleted: { table: unknown }[] = [];
  const tx = {
    insert: (table: unknown) => ({
      // A thenable that also exposes `.returning()`, because the will writer
      // mixes both patterns: `await .values()` for recipients, `.returning()`
      // for a bequest whose generated id its recipients need.
      values: (values: unknown) => {
        inserted.push({ table, values });
        const result = Promise.resolve([{ id: returnedId ?? "child-id" }]);
        (result as unknown as Record<string, unknown>).returning = async () => [
          { id: returnedId ?? "child-id" },
        ];
        return result;
      },
    }),
    delete: (table: unknown) => ({
      where: async () => {
        deleted.push({ table });
      },
    }),
  };
  return { tx, inserted, deleted };
}

/** ChildWriter ctx with an optional synthetic-id → DB-uuid remap. */
const makeCtx = (idRemap = new Map<string, string>()) => ({
  clientId: "c1",
  baseScenarioId: "base1",
  idRemap,
});

// ── writeAccountChildren ───────────────────────────────────────────────────

describe("writeAccountChildren", () => {
  it("writes account owners from the raw add payload", async () => {
    const { tx, inserted } = makeTx();
    const raw = {
      owners: [{ kind: "family_member", familyMemberId: "fm1", percent: 100 }],
    };
    await writeAccountChildren(tx as never, "acct-db-id", raw);
    expect(inserted).toHaveLength(1);
    expect((inserted[0].values as Record<string, unknown>).accountId).toBe("acct-db-id");
    expect((inserted[0].values as Record<string, unknown>).percent).toBe("100");
    expect((inserted[0].values as Record<string, unknown>).familyMemberId).toBe("fm1");
    expect((inserted[0].values as Record<string, unknown>).entityId).toBeNull();
    expect((inserted[0].values as Record<string, unknown>).externalBeneficiaryId).toBeNull();
  });

  it("writes entity owner correctly", async () => {
    const { tx, inserted } = makeTx();
    const raw = {
      owners: [{ kind: "entity", entityId: "ent1", percent: 100 }],
    };
    await writeAccountChildren(tx as never, "acct2", raw);
    const vals = inserted[0].values as Record<string, unknown>;
    expect(vals.entityId).toBe("ent1");
    expect(vals.familyMemberId).toBeNull();
    expect(vals.externalBeneficiaryId).toBeNull();
  });

  it("writes external_beneficiary owner correctly", async () => {
    const { tx, inserted } = makeTx();
    const raw = {
      owners: [{ kind: "external_beneficiary", externalBeneficiaryId: "eb1", percent: 50 }],
    };
    await writeAccountChildren(tx as never, "acct3", raw);
    const vals = inserted[0].values as Record<string, unknown>;
    expect(vals.externalBeneficiaryId).toBe("eb1");
    expect(vals.familyMemberId).toBeNull();
    expect(vals.entityId).toBeNull();
  });

  it("skips owners when array is empty", async () => {
    const { tx, inserted } = makeTx();
    await writeAccountChildren(tx as never, "a1", { owners: [] });
    expect(inserted).toHaveLength(0);
  });

  it("skips owners when not present in raw", async () => {
    const { tx, inserted } = makeTx();
    await writeAccountChildren(tx as never, "a1", {});
    expect(inserted).toHaveLength(0);
  });
});

// ── writeLiabilityChildren ─────────────────────────────────────────────────

describe("writeLiabilityChildren", () => {
  it("writes liability owners", async () => {
    const { tx, inserted } = makeTx();
    const raw = {
      owners: [{ kind: "family_member", familyMemberId: "fm2", percent: 100 }],
    };
    await writeLiabilityChildren(tx as never, "liab-db-id", raw);
    expect(inserted).toHaveLength(1);
    const vals = inserted[0].values as Record<string, unknown>;
    expect(vals.liabilityId).toBe("liab-db-id");
    expect(vals.familyMemberId).toBe("fm2");
    expect(vals.percent).toBe("100");
  });

  it("writes extra payments", async () => {
    const { tx, inserted } = makeTx();
    const raw = {
      extraPayments: [{ year: 2030, type: "lump_sum", amount: 5000 }],
    };
    await writeLiabilityChildren(tx as never, "liab2", raw);
    expect(inserted).toHaveLength(1);
    const vals = inserted[0].values as Record<string, unknown>;
    expect(vals.liabilityId).toBe("liab2");
    expect(vals.year).toBe(2030);
    expect(vals.amount).toBe("5000");
  });

  it("writes both owners and extra payments", async () => {
    const { tx, inserted } = makeTx();
    const raw = {
      owners: [{ kind: "entity", entityId: "ent2", percent: 100 }],
      extraPayments: [{ year: 2028, type: "per_payment", amount: 200 }],
    };
    await writeLiabilityChildren(tx as never, "liab3", raw);
    expect(inserted).toHaveLength(2);
  });

  it("skips missing arrays gracefully", async () => {
    const { tx, inserted } = makeTx();
    await writeLiabilityChildren(tx as never, "liab4", {});
    expect(inserted).toHaveLength(0);
  });

  // I8: `liability_owners` has a CHECK requiring exactly one of
  // (family_member_id, entity_id). An `external_beneficiary` or `gifted_away`
  // owner lands BOTH null, and Postgres then aborts the whole promote
  // transaction with a constraint name instead of a message. The dissolve
  // lever's `returnOwnersToHeir` deliberately preserves non-trust slices,
  // including a `gifted_away` one, and this branch adds the first solver writer
  // of liability owners — so the shape is reachable.
  it.each(["external_beneficiary", "gifted_away"] as const)(
    "throws a named error for a %s owner instead of aborting the promote on a CHECK",
    async (kind) => {
      const { tx, inserted } = makeTx();
      const raw = {
        owners: [
          { kind: "family_member", familyMemberId: "fm2", percent: 0.5 },
          { kind, externalBeneficiaryId: "eb1", recipient: { kind: "family_member", id: "fm9" }, percent: 0.5 },
        ],
      };
      await expect(
        writeLiabilityChildren(tx as never, "liab-x", raw),
      ).rejects.toThrow(new RegExp(`${kind}.*liability_owners`));
      // The good row may already be in; what matters is that the failure is
      // legible rather than a constraint name from Postgres.
      expect(inserted.length).toBeLessThanOrEqual(1);
    },
  );

  it("throws for an unmappable owner on an EDIT too, not just an add", async () => {
    const { tx } = makeTx();
    await expect(
      updateLiabilityChildren(tx as never, "liab-x", {
        owners: [{ kind: "gifted_away", recipient: { kind: "entity", id: "e1" }, percent: 1 }],
      }),
    ).rejects.toThrow(/gifted_away.*liability_owners/);
  });
});

// ── writeIncomeChildren ────────────────────────────────────────────────────

describe("writeIncomeChildren", () => {
  it("writes income schedule overrides", async () => {
    const { tx, inserted } = makeTx();
    const raw = {
      scheduleOverrides: { 2030: 50000, 2031: 55000 },
    };
    await writeIncomeChildren(tx as never, "inc-id", raw);
    expect(inserted).toHaveLength(2);
    const years = inserted.map((r) => (r.values as Record<string, unknown>).year);
    expect(years).toContain(2030);
    expect(years).toContain(2031);
    const amounts = inserted.map((r) => (r.values as Record<string, unknown>).amount);
    expect(amounts).toContain("50000");
    expect(amounts).toContain("55000");
    for (const row of inserted) {
      expect((row.values as Record<string, unknown>).incomeId).toBe("inc-id");
    }
  });

  it("skips when no scheduleOverrides", async () => {
    const { tx, inserted } = makeTx();
    await writeIncomeChildren(tx as never, "inc2", {});
    expect(inserted).toHaveLength(0);
  });
});

// ── writeExpenseChildren ───────────────────────────────────────────────────

describe("writeExpenseChildren", () => {
  it("writes expense schedule overrides", async () => {
    const { tx, inserted } = makeTx();
    const raw = { scheduleOverrides: { 2032: 12000 } };
    await writeExpenseChildren(tx as never, "exp-id", raw, makeCtx());
    expect(inserted).toHaveLength(1);
    const vals = inserted[0].values as Record<string, unknown>;
    expect(vals.expenseId).toBe("exp-id");
    expect(vals.year).toBe(2032);
    expect(vals.amount).toBe("12000");
  });

  it("writes dedicated-account join rows in draw order", async () => {
    const { tx, inserted } = makeTx();
    const raw = { dedicatedAccountIds: ["a529-1", "a529-2"] };
    await writeExpenseChildren(tx as never, "exp-id", raw, makeCtx());
    expect(inserted).toHaveLength(2);
    expect(inserted[0].table).toBe(expenseDedicatedAccounts);
    const vals0 = inserted[0].values as Record<string, unknown>;
    const vals1 = inserted[1].values as Record<string, unknown>;
    expect(vals0).toMatchObject({ expenseId: "exp-id", accountId: "a529-1", sortOrder: 0 });
    expect(vals1).toMatchObject({ expenseId: "exp-id", accountId: "a529-2", sortOrder: 1 });
  });

  it("dedupes dedicated ids to respect the (expense_id, account_id) unique constraint", async () => {
    const { tx, inserted } = makeTx();
    const raw = { dedicatedAccountIds: ["a1", "a1", "a2"] };
    await writeExpenseChildren(tx as never, "exp-id", raw, makeCtx());
    expect(inserted).toHaveLength(2);
    const ids = inserted.map((r) => (r.values as Record<string, unknown>).accountId);
    expect(ids).toEqual(["a1", "a2"]);
  });

  it("remaps same-batch synthetic account ids via ctx.idRemap", async () => {
    const { tx, inserted } = makeTx();
    const raw = { dedicatedAccountIds: ["syn-529"] };
    await writeExpenseChildren(
      tx as never,
      "exp-id",
      raw,
      makeCtx(new Map([["syn-529", "db-529"]])),
    );
    expect(inserted).toHaveLength(1);
    expect((inserted[0].values as Record<string, unknown>).accountId).toBe("db-529");
  });

  it("writes both schedule overrides and dedicated rows", async () => {
    const { tx, inserted } = makeTx();
    const raw = { scheduleOverrides: { 2032: 12000 }, dedicatedAccountIds: ["a1"] };
    await writeExpenseChildren(tx as never, "exp-id", raw, makeCtx());
    expect(inserted).toHaveLength(2);
  });

  it("skips when no scheduleOverrides or dedicated ids", async () => {
    const { tx, inserted } = makeTx();
    await writeExpenseChildren(tx as never, "exp2", {}, makeCtx());
    await writeExpenseChildren(tx as never, "exp2", { dedicatedAccountIds: [] }, makeCtx());
    expect(inserted).toHaveLength(0);
  });
});

// ── updateExpenseChildren ──────────────────────────────────────────────────

describe("updateExpenseChildren", () => {
  it("no-ops when dedicatedAccountIds is not in the edit set", async () => {
    const { tx, inserted, deleted } = makeTx();
    await updateExpenseChildren(tx as never, "exp-id", { annualAmount: 20000 }, makeCtx());
    expect(inserted).toHaveLength(0);
    expect(deleted).toHaveLength(0);
  });

  it("rewrites dedicated rows (delete-then-reinsert) in draw order", async () => {
    const { tx, inserted, deleted } = makeTx();
    const set = { annualAmount: 20000, dedicatedAccountIds: ["a2", "a1"] };
    await updateExpenseChildren(tx as never, "exp-id", set, makeCtx());
    expect(deleted).toHaveLength(1);
    expect(deleted[0].table).toBe(expenseDedicatedAccounts);
    expect(inserted).toHaveLength(2);
    expect(inserted[0].values as Record<string, unknown>).toMatchObject({
      expenseId: "exp-id",
      accountId: "a2",
      sortOrder: 0,
    });
    expect(inserted[1].values as Record<string, unknown>).toMatchObject({
      expenseId: "exp-id",
      accountId: "a1",
      sortOrder: 1,
    });
  });

  it("clears all rows when the edit set carries an empty or undefined value", async () => {
    const { tx, inserted, deleted } = makeTx();
    await updateExpenseChildren(tx as never, "e1", { dedicatedAccountIds: [] }, makeCtx());
    await updateExpenseChildren(tx as never, "e2", { dedicatedAccountIds: undefined }, makeCtx());
    expect(deleted).toHaveLength(2);
    expect(inserted).toHaveLength(0);
  });

  it("dedupes and remaps synthetic ids via ctx.idRemap", async () => {
    const { tx, inserted } = makeTx();
    const set = { dedicatedAccountIds: ["syn-529", "syn-529", "a1"] };
    await updateExpenseChildren(
      tx as never,
      "exp-id",
      set,
      makeCtx(new Map([["syn-529", "db-529"]])),
    );
    expect(inserted).toHaveLength(2);
    const ids = inserted.map((r) => (r.values as Record<string, unknown>).accountId);
    expect(ids).toEqual(["db-529", "a1"]);
  });
});

// ── writeSavingsRuleChildren ───────────────────────────────────────────────

describe("writeSavingsRuleChildren", () => {
  it("writes savings schedule overrides", async () => {
    const { tx, inserted } = makeTx();
    const raw = { scheduleOverrides: { 2033: 6000, 2034: 7000 } };
    await writeSavingsRuleChildren(tx as never, "sr-id", raw, makeCtx());
    expect(inserted).toHaveLength(2);
    for (const row of inserted) {
      expect((row.values as Record<string, unknown>).savingsRuleId).toBe("sr-id");
    }
  });

  it("skips when no scheduleOverrides", async () => {
    const { tx, inserted } = makeTx();
    await writeSavingsRuleChildren(tx as never, "sr2", {}, makeCtx());
    expect(inserted).toHaveLength(0);
  });

  it("writes salary-income join rows in list order (array index = sortOrder)", async () => {
    const { tx, inserted } = makeTx();
    const raw = { salaryIncomeIds: ["inc-b", "inc-a"] };
    await writeSavingsRuleChildren(tx as never, "sr-id", raw, makeCtx());
    expect(inserted).toHaveLength(1);
    expect(inserted[0].table).toBe(savingsRuleSalaryIncomes);
    expect(inserted[0].values).toEqual([
      { savingsRuleId: "sr-id", incomeId: "inc-b", sortOrder: 0 },
      { savingsRuleId: "sr-id", incomeId: "inc-a", sortOrder: 1 },
    ]);
  });

  it("still writes salary rows when the rule has no schedule overrides", async () => {
    const { tx, inserted } = makeTx();
    await writeSavingsRuleChildren(
      tx as never,
      "sr-id",
      { scheduleOverrides: { 2033: 6000 }, salaryIncomeIds: ["inc-a"] },
      makeCtx(),
    );
    // one override row + one salary-income batch
    expect(inserted).toHaveLength(2);
    expect(inserted[1].table).toBe(savingsRuleSalaryIncomes);
  });

  it("does not touch the salary join table when salaryIncomeIds is absent or empty", async () => {
    const { tx, inserted, deleted } = makeTx();
    await writeSavingsRuleChildren(tx as never, "sr1", {}, makeCtx());
    await writeSavingsRuleChildren(tx as never, "sr2", { salaryIncomeIds: [] }, makeCtx());
    expect(inserted).toHaveLength(0);
    expect(deleted).toHaveLength(0);
  });

  it("remaps a same-batch synthetic income id via ctx.idRemap", async () => {
    // The scope guard runs BEFORE the transaction and deliberately skips ids
    // satisfied by an in-batch income insert; those arrive here as synthetic
    // ids and MUST be resolved, or the FK to incomes.id rejects the promotion.
    const { tx, inserted } = makeTx();
    await writeSavingsRuleChildren(
      tx as never,
      "sr-id",
      { salaryIncomeIds: ["syn-inc", "inc-a"] },
      makeCtx(new Map([["syn-inc", "db-inc"]])),
    );
    expect(inserted[0].values).toEqual([
      { savingsRuleId: "sr-id", incomeId: "db-inc", sortOrder: 0 },
      { savingsRuleId: "sr-id", incomeId: "inc-a", sortOrder: 1 },
    ]);
  });

  it("dedupes repeated ids (the table's UNIQUE(rule, income) would 500)", async () => {
    const { tx, inserted } = makeTx();
    await writeSavingsRuleChildren(
      tx as never,
      "sr-id",
      { salaryIncomeIds: ["inc-a", "inc-a", "inc-b"] },
      makeCtx(),
    );
    expect(inserted[0].values).toEqual([
      { savingsRuleId: "sr-id", incomeId: "inc-a", sortOrder: 0 },
      { savingsRuleId: "sr-id", incomeId: "inc-b", sortOrder: 1 },
    ]);
  });
});

// ── updateSavingsRuleChildren ──────────────────────────────────────────────

describe("updateSavingsRuleChildren", () => {
  it("no-ops when salaryIncomeIds is not in the edit set", async () => {
    const { tx, inserted, deleted } = makeTx();
    await updateSavingsRuleChildren(tx as never, "sr-id", { annualPercent: 0.1 }, makeCtx());
    expect(inserted).toHaveLength(0);
    expect(deleted).toHaveLength(0);
  });

  it("rewrites the salary rows (delete-then-reinsert) in list order", async () => {
    const { tx, inserted, deleted } = makeTx();
    await updateSavingsRuleChildren(
      tx as never,
      "sr-id",
      { salaryBasis: "selected", salaryIncomeIds: ["inc-b", "inc-a"] },
      makeCtx(),
    );
    expect(deleted).toHaveLength(1);
    expect(inserted).toHaveLength(1);
    expect(inserted[0].values).toEqual([
      { savingsRuleId: "sr-id", incomeId: "inc-b", sortOrder: 0 },
      { savingsRuleId: "sr-id", incomeId: "inc-a", sortOrder: 1 },
    ]);
  });

  it("clears the salary rows when the edit set carries an empty or undefined value", async () => {
    const { tx, inserted, deleted } = makeTx();
    await updateSavingsRuleChildren(tx as never, "s1", { salaryIncomeIds: [] }, makeCtx());
    await updateSavingsRuleChildren(tx as never, "s2", { salaryIncomeIds: undefined }, makeCtx());
    expect(deleted).toHaveLength(2);
    expect(inserted).toHaveLength(0);
  });

  it("remaps synthetic ids via ctx.idRemap", async () => {
    const { tx, inserted } = makeTx();
    await updateSavingsRuleChildren(
      tx as never,
      "sr-id",
      { salaryIncomeIds: ["syn-inc"] },
      makeCtx(new Map([["syn-inc", "db-inc"]])),
    );
    expect(inserted[0].values).toEqual([
      { savingsRuleId: "sr-id", incomeId: "db-inc", sortOrder: 0 },
    ]);
  });
});

// ── writeTransferChildren ──────────────────────────────────────────────────

describe("writeTransferChildren", () => {
  it("writes transfer schedules", async () => {
    const { tx, inserted } = makeTx();
    const raw = {
      schedules: [
        { year: 2026, amount: 10000 },
        { year: 2027, amount: 11000 },
      ],
    };
    await writeTransferChildren(tx as never, "tr-id", raw);
    expect(inserted).toHaveLength(2);
    for (const row of inserted) {
      expect((row.values as Record<string, unknown>).transferId).toBe("tr-id");
    }
    const amounts = inserted.map((r) => (r.values as Record<string, unknown>).amount);
    expect(amounts).toContain("10000");
    expect(amounts).toContain("11000");
  });

  it("skips when schedules is empty", async () => {
    const { tx, inserted } = makeTx();
    await writeTransferChildren(tx as never, "tr2", { schedules: [] });
    expect(inserted).toHaveLength(0);
  });
});

// ── writeRothConversionChildren ────────────────────────────────────────────

describe("writeRothConversionChildren", () => {
  it("writes roth conversion sources", async () => {
    const { tx, inserted } = makeTx();
    const raw = {
      sourceAccountIds: ["acct-a", "acct-b"],
    };
    await writeRothConversionChildren(tx as never, "rc-id", raw);
    expect(inserted).toHaveLength(2);
    const rcIds = inserted.map((r) => (r.values as Record<string, unknown>).rothConversionId);
    expect(rcIds).toEqual(["rc-id", "rc-id"]);
    const accountIds = inserted.map((r) => (r.values as Record<string, unknown>).accountId);
    expect(accountIds).toContain("acct-a");
    expect(accountIds).toContain("acct-b");
    // sortOrder should be 0-based index
    expect((inserted[0].values as Record<string, unknown>).sortOrder).toBe(0);
    expect((inserted[1].values as Record<string, unknown>).sortOrder).toBe(1);
  });

  it("skips when sourceAccountIds is empty", async () => {
    const { tx, inserted } = makeTx();
    await writeRothConversionChildren(tx as never, "rc2", { sourceAccountIds: [] });
    expect(inserted).toHaveLength(0);
  });
});

// ── writeReinvestmentChildren ──────────────────────────────────────────────

describe("writeReinvestmentChildren", () => {
  it("writes reinvestment accounts from accountIds", async () => {
    const { tx, inserted } = makeTx();
    const raw = { accountIds: ["acc1", "acc2"] };
    await writeReinvestmentChildren(tx as never, "ri-id", raw);
    expect(inserted).toHaveLength(2);
    for (const row of inserted) {
      expect((row.values as Record<string, unknown>).reinvestmentId).toBe("ri-id");
    }
    const accountIds = inserted.map((r) => (r.values as Record<string, unknown>).accountId);
    expect(accountIds).toContain("acc1");
    expect(accountIds).toContain("acc2");
  });

  it("writes reinvestment groups from groupKeys", async () => {
    const { tx, inserted } = makeTx();
    const raw = { groupKeys: ["all-liquid", "retirement"] };
    await writeReinvestmentChildren(tx as never, "ri2", raw);
    expect(inserted).toHaveLength(2);
    for (const row of inserted) {
      expect((row.values as Record<string, unknown>).reinvestmentId).toBe("ri2");
    }
    const keys = inserted.map((r) => (r.values as Record<string, unknown>).groupKey);
    expect(keys).toContain("all-liquid");
    expect(keys).toContain("retirement");
  });

  it("writes both accounts and groups", async () => {
    const { tx, inserted } = makeTx();
    const raw = { accountIds: ["acc3"], groupKeys: ["taxable"] };
    await writeReinvestmentChildren(tx as never, "ri3", raw);
    expect(inserted).toHaveLength(2);
  });

  it("skips when no accountIds or groupKeys", async () => {
    const { tx, inserted } = makeTx();
    await writeReinvestmentChildren(tx as never, "ri4", {});
    expect(inserted).toHaveLength(0);
  });
});

// ── writeWillChildren ──────────────────────────────────────────────────────

describe("writeWillChildren", () => {
  it("writes will bequests and their recipients", async () => {
    const inserted: { table: unknown; values: unknown }[] = [];
    // The will writer mixes two insert patterns:
    //   - willBequests: uses `.returning()` to get the generated bequest id
    //   - willBequestRecipients / willResiduaryRecipients: plain `await .values()`
    // The fake tx must support both. We return a thenable from `.values()` that
    // also exposes `.returning()`.
    const tx = {
      insert: (table: unknown) => ({
        values: (values: unknown) => {
          inserted.push({ table, values });
          const result = Promise.resolve(undefined);
          (result as unknown as Record<string, unknown>).returning = async () => [{ id: "bequest-db-id" }];
          return result;
        },
      }),
    };

    const raw = {
      bequests: [
        {
          name: "House",
          kind: "asset",
          assetMode: "specific",
          accountId: "acc-house",
          entityId: null,
          liabilityId: null,
          percentage: 100,
          condition: "always",
          sortOrder: 0,
          recipients: [
            { recipientKind: "family_member", recipientId: "fm3", percentage: 100, sortOrder: 0 },
          ],
        },
      ],
      residuaryRecipients: [
        { recipientKind: "family_member", recipientId: "fm4", percentage: 100, sortOrder: 0 },
      ],
    };

    await writeWillChildren(tx as never, "will-db-id", raw);

    // 1 bequest + 1 bequest recipient + 1 residuary recipient = 3 inserts
    expect(inserted).toHaveLength(3);
    const bequestRow = inserted.find(
      (r) => (r.values as Record<string, unknown>).willId === "will-db-id" &&
        (r.values as Record<string, unknown>).name === "House",
    );
    expect(bequestRow).toBeTruthy();
    expect((bequestRow!.values as Record<string, unknown>).percentage).toBe("100");

    const recipientRow = inserted.find(
      (r) => (r.values as Record<string, unknown>).bequestId === "bequest-db-id",
    );
    expect(recipientRow).toBeTruthy();
    expect((recipientRow!.values as Record<string, unknown>).recipientKind).toBe("family_member");

    const residuaryRow = inserted.find(
      (r) => (r.values as Record<string, unknown>).willId === "will-db-id" &&
        !(r.values as Record<string, unknown>).bequestId &&
        !(r.values as Record<string, unknown>).name,
    );
    expect(residuaryRow).toBeTruthy();
    expect((residuaryRow!.values as Record<string, unknown>).recipientId).toBe("fm4");
  });

  it("skips bequests and residuary when arrays are empty/absent", async () => {
    const inserted: { table: unknown; values: unknown }[] = [];
    const tx = {
      insert: (table: unknown) => ({
        values: (values: unknown) => {
          inserted.push({ table, values });
          const result = Promise.resolve(undefined);
          (result as unknown as Record<string, unknown>).returning = async () => [{ id: "x" }];
          return result;
        },
      }),
    };
    await writeWillChildren(tx as never, "w2", {});
    expect(inserted).toHaveLength(0);
  });
});

// ── updateWillChildren / updateLiabilityChildren ───────────────────────────
//
// `coerceForTable` filters an EDIT's `set` down to real table columns, so an
// array field with no updater simply vanishes and the UPDATE degrades to a
// silent `updatedAt` no-op. Promoting a trust dissolve then leaves the base will
// still paying to the trust the same promote deleted — and
// `will_bequest_recipients.recipientId` carries NO foreign key, so nothing ever
// cleans the orphan up.

describe("updateWillChildren", () => {
  it("no-ops when neither array is in the edit set", async () => {
    const { tx, inserted, deleted } = makeTx();
    await updateWillChildren(tx as never, "will-1", { grantor: "spouse" });
    expect(inserted).toHaveLength(0);
    expect(deleted).toHaveLength(0);
  });

  it("rewrites bequests (delete-then-reinsert) with their recipients", async () => {
    const { tx, inserted, deleted } = makeTx("bq-db-id");
    const set = {
      bequests: [
        {
          name: "To Amy", kind: "asset", assetMode: "specific", accountId: "a1",
          entityId: null, liabilityId: null, percentage: 100, condition: "always",
          sortOrder: 0,
          recipients: [
            { recipientKind: "family_member", recipientId: "fm-spouse", percentage: 100, sortOrder: 0 },
          ],
        },
      ],
    };
    await updateWillChildren(tx as never, "will-1", set);
    expect(deleted.map((d) => d.table)).toEqual([willBequests]);
    expect(inserted.map((i) => i.table)).toHaveLength(2);
    expect(inserted[0].values as Record<string, unknown>).toMatchObject({ willId: "will-1" });
    expect(inserted[1].values as Record<string, unknown>).toMatchObject({
      bequestId: "bq-db-id",
      recipientId: "fm-spouse",
    });
  });

  it("clears every bequest when the dissolve emptied the array", async () => {
    const { tx, inserted, deleted } = makeTx();
    await updateWillChildren(tx as never, "will-1", { bequests: [] });
    expect(deleted.map((d) => d.table)).toEqual([willBequests]);
    expect(inserted).toHaveLength(0);
  });

  it("rewrites residuary recipients independently of bequests", async () => {
    const { tx, inserted, deleted } = makeTx();
    const set = {
      residuaryRecipients: [
        { recipientKind: "family_member", recipientId: "fm-spouse", percentage: 40, sortOrder: 0 },
      ],
    };
    await updateWillChildren(tx as never, "will-1", set);
    expect(deleted.map((d) => d.table)).toEqual([willResiduaryRecipients]);
    expect(inserted).toHaveLength(1);
    expect(inserted[0].values as Record<string, unknown>).toMatchObject({
      willId: "will-1",
      recipientId: "fm-spouse",
      // A string percentage makes the engine concatenate rather than add; the
      // column is numeric, so coerceForTable stringifies it exactly once.
      percentage: "40",
    });
  });
});

describe("updateLiabilityChildren", () => {
  it("no-ops when neither array is in the edit set", async () => {
    const { tx, inserted, deleted } = makeTx();
    await updateLiabilityChildren(tx as never, "liab-1", { balance: 90000 });
    expect(inserted).toHaveLength(0);
    expect(deleted).toHaveLength(0);
  });

  it("rewrites owners after a retitle out of a trust", async () => {
    const { tx, inserted, deleted } = makeTx();
    const set = {
      owners: [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }],
    };
    await updateLiabilityChildren(tx as never, "liab-1", set);
    expect(deleted.map((d) => d.table)).toEqual([liabilityOwners]);
    expect(inserted).toHaveLength(1);
    expect(inserted[0].values as Record<string, unknown>).toMatchObject({
      liabilityId: "liab-1",
      familyMemberId: "fm-client",
      entityId: null,
      percent: "1",
    });
  });

  it("rewrites extra payments independently of owners", async () => {
    const { tx, inserted, deleted } = makeTx();
    const set = { extraPayments: [{ year: 2030, type: "lump_sum", amount: 5000 }] };
    await updateLiabilityChildren(tx as never, "liab-1", set);
    expect(deleted.map((d) => d.table)).toEqual([extraPayments]);
    expect(inserted).toHaveLength(1);
    expect(inserted[0].values as Record<string, unknown>).toMatchObject({
      liabilityId: "liab-1",
      year: 2030,
    });
  });
});
