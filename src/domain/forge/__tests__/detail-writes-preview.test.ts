// src/domain/copilot/__tests__/detail-writes-preview.test.ts
//
// Dry-run preview for the expense write tools. `describeProposedWrite` with an
// auth context must:
//   (a) render the would-be-new-row `field: value` lines for a valid add_expense
//       WITHOUT inserting (the preview is a pure dry run — zod + FK asserts only);
//   (b) surface the plain-language validation error as `summary` when the payload
//       is invalid (here: both ownerEntityId + ownerAccountId set);
//   (c) degrade to the pure formatter (never throw) when enrichment itself throws.
//
// Gated on DATABASE_URL so it skips cleanly in DB-less CI (the FK asserts and the
// db.insert spy reference the live db). Mirrors preview-fidelity.test.ts.
import { describe, it, expect, vi, afterEach } from "vitest";
import { describeProposedWrite } from "../preview";
import type { ProposedWrite } from "../preview";
import { expenseCreateSchema } from "@/lib/schemas/expenses";
import { incomeCreateSchema } from "@/lib/schemas/incomes";
import { liabilityCreateSchema } from "@/lib/schemas/liabilities";
import { accountCreateSchema } from "@/lib/schemas/accounts";
import type { ForgeAuthContext } from "@/domain/forge/state";
import { db } from "@/db";
import { accounts } from "@/db/schema";
import { eq, and } from "drizzle-orm";

const COOPER_CLIENT_ID = "877a9532-f8ea-49b0-9db7-aadd64fab82a";
const COOPER_FIRM_ID = "org_3CitTEIe8PJa1BVYw7LnEjkiP9r";
// Cooper "Consulting Business" account (category === "business") — a valid parent.
const COOPER_BUSINESS_ACCOUNT_ID = "f43af48f-178c-417f-8934-79dba967de93";
// Cooper "client" family member — used for the owners[] cascade-line path.
const COOPER_FM_ID = "7f875f15-50f6-4ef2-8f18-8a0b1f8b3997";
// An account that belongs to a DIFFERENT client — proves cross-tenant FK rejection.
const FOREIGN_ACCOUNT_ID = "3d552610-0eff-47b4-a7bf-fe3a3805d876";

const HAS_DB = !!process.env.DATABASE_URL;

const ctx: ForgeAuthContext = {
  userId: "user_test",
  firmId: COOPER_FIRM_ID,
  clientId: COOPER_CLIENT_ID,
  scenarioId: "base",
};

describe.skipIf(!HAS_DB)("detail-writes preview (add_expense dry run)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the would-be-new-row field lines and does NOT insert", async () => {
    const insertSpy = vi.spyOn(db, "insert");
    const call: ProposedWrite = {
      name: "add_expense",
      args: {
        type: "discretionary",
        name: "Annual vacation",
        annualAmount: 12000,
        startYear: 2030,
        endYear: 2040,
      },
    };
    const preview = await describeProposedWrite(call, ctx);

    // The dry run never writes.
    expect(insertSpy).not.toHaveBeenCalled();

    expect(preview.name).toBe("add_expense");
    expect(preview.summary).toMatch(/Add expense/i);
    expect(preview.details).toBeDefined();
    const text = preview.details!.join(" ");
    // createDiffLines renders the parsed, defaulted row as `field: value` lines.
    expect(text).toMatch(/name: Annual vacation/);
    expect(text).toMatch(/annualAmount: 12000/);
    expect(text).toMatch(/startYear: 2030/);
    expect(text).toMatch(/endYear: 2040/);
  });

  it("surfaces the both-owner validation error as the summary (no insert)", async () => {
    const insertSpy = vi.spyOn(db, "insert");
    const call: ProposedWrite = {
      name: "add_expense",
      args: {
        type: "discretionary",
        name: "Bad expense",
        startYear: 2030,
        endYear: 2040,
        ownerEntityId: "11111111-1111-1111-1111-111111111111",
        ownerAccountId: "22222222-2222-2222-2222-222222222222",
      },
    };
    const preview = await describeProposedWrite(call, ctx);

    expect(insertSpy).not.toHaveBeenCalled();
    expect(preview.name).toBe("add_expense");
    expect(preview.summary).toMatch(/Cannot set both ownerEntityId and ownerAccountId/i);
    // A validation failure renders no field diff.
    expect(preview.details).toBeUndefined();
  });

  it("degrades to the pure formatter when enrichment throws", async () => {
    // Force the enrichment to throw mid-flight; the wrapper must swallow it and
    // return the pure preview rather than blocking approval.
    vi.spyOn(expenseCreateSchema, "safeParse").mockImplementation(() => {
      throw new Error("boom");
    });
    const call: ProposedWrite = {
      name: "add_expense",
      args: { type: "discretionary", name: "Vacation", startYear: 2030, endYear: 2040 },
    };
    const preview = await describeProposedWrite(call, ctx);

    // Pure formatter result: named summary, NO enriched details.
    expect(preview.name).toBe("add_expense");
    expect(preview.summary).toMatch(/Add expense/i);
    expect(preview.details).toBeUndefined();
  });
});

describe.skipIf(!HAS_DB)("detail-writes preview (add_income dry run)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the would-be-new-row field lines and does NOT insert", async () => {
    const insertSpy = vi.spyOn(db, "insert");
    const call: ProposedWrite = {
      name: "add_income",
      args: {
        type: "salary",
        name: "Base salary",
        annualAmount: 90000,
        startYear: 2030,
        endYear: 2040,
      },
    };
    const preview = await describeProposedWrite(call, ctx);

    // The dry run never writes.
    expect(insertSpy).not.toHaveBeenCalled();

    expect(preview.name).toBe("add_income");
    expect(preview.summary).toMatch(/Add income/i);
    expect(preview.details).toBeDefined();
    const text = preview.details!.join(" ");
    // createDiffLines renders the parsed, defaulted row as `field: value` lines.
    expect(text).toMatch(/name: Base salary/);
    expect(text).toMatch(/annualAmount: 90000/);
    expect(text).toMatch(/startYear: 2030/);
    expect(text).toMatch(/endYear: 2040/);
  });

  it("surfaces the both-owner validation error as the summary (no insert)", async () => {
    const insertSpy = vi.spyOn(db, "insert");
    const call: ProposedWrite = {
      name: "add_income",
      args: {
        type: "salary",
        name: "Bad income",
        startYear: 2030,
        endYear: 2040,
        ownerEntityId: "11111111-1111-1111-1111-111111111111",
        ownerAccountId: "22222222-2222-2222-2222-222222222222",
      },
    };
    const preview = await describeProposedWrite(call, ctx);

    expect(insertSpy).not.toHaveBeenCalled();
    expect(preview.name).toBe("add_income");
    expect(preview.summary).toMatch(/Cannot set both ownerEntityId and ownerAccountId/i);
    // A validation failure renders no field diff.
    expect(preview.details).toBeUndefined();
  });

  it("degrades to the pure formatter when enrichment throws", async () => {
    vi.spyOn(incomeCreateSchema, "safeParse").mockImplementation(() => {
      throw new Error("boom");
    });
    const call: ProposedWrite = {
      name: "add_income",
      args: { type: "salary", name: "Salary", startYear: 2030, endYear: 2040 },
    };
    const preview = await describeProposedWrite(call, ctx);

    // Pure formatter result: named summary, NO enriched details.
    expect(preview.name).toBe("add_income");
    expect(preview.summary).toMatch(/Add income/i);
    expect(preview.details).toBeUndefined();
  });
});

describe.skipIf(!HAS_DB)("detail-writes preview (add_liability dry run)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the would-be-new-row field lines and does NOT insert", async () => {
    const insertSpy = vi.spyOn(db, "insert");
    const call: ProposedWrite = {
      name: "add_liability",
      args: {
        name: "Mortgage",
        startYear: 2030,
        termMonths: 120,
        balance: 200000,
      },
    };
    const preview = await describeProposedWrite(call, ctx);

    // The dry run never writes.
    expect(insertSpy).not.toHaveBeenCalled();

    expect(preview.name).toBe("add_liability");
    expect(preview.summary).toMatch(/Add liability/i);
    expect(preview.details).toBeDefined();
    const text = preview.details!.join(" ");
    // createDiffLines renders the parsed, defaulted row as `field: value` lines.
    expect(text).toMatch(/name: Mortgage/);
    expect(text).toMatch(/balance: 200000/);
    expect(text).toMatch(/startYear: 2030/);
    expect(text).toMatch(/termMonths: 120/);
  });

  it("renders the parent-business cascade line when parentAccountId is set", async () => {
    const call: ProposedWrite = {
      name: "add_liability",
      args: {
        name: "Business loan",
        startYear: 2030,
        termMonths: 120,
        balance: 50000,
        parentAccountId: COOPER_BUSINESS_ACCOUNT_ID,
      },
    };
    const preview = await describeProposedWrite(call, ctx);

    expect(preview.name).toBe("add_liability");
    expect(preview.details).toBeDefined();
    const text = preview.details!.join(" ");
    expect(text).toMatch(/Owned via parent business account \(no separate owners\)\./);
  });

  it("renders an owner cascade line when owners[] is provided", async () => {
    const call: ProposedWrite = {
      name: "add_liability",
      args: {
        name: "Joint mortgage",
        startYear: 2030,
        termMonths: 120,
        balance: 300000,
        owners: [
          { kind: "family_member", familyMemberId: COOPER_FM_ID, percent: 1.0 },
        ],
      },
    };
    const preview = await describeProposedWrite(call, ctx);

    expect(preview.name).toBe("add_liability");
    expect(preview.details).toBeDefined();
    const text = preview.details!.join(" ");
    expect(text).toMatch(/Owner: family_member .* \(100%\)/);
  });

  it("surfaces the cross-tenant linkedPropertyId FK error as the summary (no insert)", async () => {
    const insertSpy = vi.spyOn(db, "insert");
    const call: ProposedWrite = {
      name: "add_liability",
      args: {
        name: "Bad liability",
        startYear: 2030,
        termMonths: 120,
        linkedPropertyId: FOREIGN_ACCOUNT_ID,
      },
    };
    const preview = await describeProposedWrite(call, ctx);

    expect(insertSpy).not.toHaveBeenCalled();
    expect(preview.name).toBe("add_liability");
    expect(preview.summary).toMatch(/not owned by this client/i);
    // An FK failure renders no field diff.
    expect(preview.details).toBeUndefined();
  });

  it("surfaces the missing-termMonths validation error as the summary (no insert)", async () => {
    const insertSpy = vi.spyOn(db, "insert");
    const call: ProposedWrite = {
      name: "add_liability",
      args: { name: "Incomplete liability", startYear: 2030 },
    };
    const preview = await describeProposedWrite(call, ctx);

    expect(insertSpy).not.toHaveBeenCalled();
    expect(preview.name).toBe("add_liability");
    // termMonths is required (coerceToInt.pipe(number)) — a zod failure.
    expect(preview.summary).not.toMatch(/^Add liability/);
    expect(preview.details).toBeUndefined();
  });

  it("degrades to the pure formatter when enrichment throws", async () => {
    vi.spyOn(liabilityCreateSchema, "safeParse").mockImplementation(() => {
      throw new Error("boom");
    });
    const call: ProposedWrite = {
      name: "add_liability",
      args: { name: "Mortgage", startYear: 2030, termMonths: 120 },
    };
    const preview = await describeProposedWrite(call, ctx);

    // Pure formatter result: named summary, NO enriched details.
    expect(preview.name).toBe("add_liability");
    expect(preview.summary).toMatch(/Add liability/i);
    expect(preview.details).toBeUndefined();
  });
});

describe.skipIf(!HAS_DB)("detail-writes preview (account dry run + cascade)", () => {
  // A random uuid that is NOT a model portfolio in this firm — proves the
  // firm-scoped modelPortfolio FK assert surfaces as the summary.
  const FOREIGN_MODEL_PORTFOLIO_ID = "9c9c9c9c-9c9c-9c9c-9c9c-9c9c9c9c9c9c";

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the would-be-new-row field lines for add_account and does NOT insert", async () => {
    const insertSpy = vi.spyOn(db, "insert");
    const call: ProposedWrite = {
      name: "add_account",
      args: { name: "Brokerage", category: "taxable", value: 50000 },
    };
    const preview = await describeProposedWrite(call, ctx);

    // The dry run never writes.
    expect(insertSpy).not.toHaveBeenCalled();

    expect(preview.name).toBe("add_account");
    expect(preview.summary).toMatch(/Add account/i);
    expect(preview.details).toBeDefined();
    const text = preview.details!.join(" ");
    // createDiffLines renders the parsed, defaulted row as `field: value` lines.
    expect(text).toMatch(/name: Brokerage/);
    expect(text).toMatch(/category: taxable/);
    expect(text).toMatch(/value: 50000/);
  });

  it("renders the business-cash cascade line for a business add_account", async () => {
    const call: ProposedWrite = {
      name: "add_account",
      args: {
        name: "New Consulting LLC",
        category: "business",
        businessType: "llc",
        value: 100000,
        basis: 50000,
        owners: [{ kind: "family_member", familyMemberId: COOPER_FM_ID, percent: 1.0 }],
      },
    };
    const preview = await describeProposedWrite(call, ctx);

    expect(preview.name).toBe("add_account");
    expect(preview.details).toBeDefined();
    const text = preview.details!.join(" ");
    expect(text).toMatch(/Will also create a business-cash sub-account\./);
    // An owners[] cascade line is also rendered.
    expect(text).toMatch(/Owner: family_member .* \(100%\)/);
  });

  it("renders the holdings-recompute cascade line when deriveFromHoldings is set", async () => {
    const call: ProposedWrite = {
      name: "add_account",
      args: {
        name: "Holdings-driven brokerage",
        category: "taxable",
        value: 75000,
        deriveFromHoldings: true,
      },
    };
    const preview = await describeProposedWrite(call, ctx);

    expect(preview.name).toBe("add_account");
    expect(preview.details).toBeDefined();
    const text = preview.details!.join(" ");
    expect(text).toMatch(
      /Value and allocation will be recomputed from holdings after save \(post-write\)\./,
    );
  });

  it("surfaces the cross-tenant modelPortfolioId FK error as the summary (no insert)", async () => {
    const insertSpy = vi.spyOn(db, "insert");
    const call: ProposedWrite = {
      name: "add_account",
      args: {
        name: "Bad account",
        category: "taxable",
        modelPortfolioId: FOREIGN_MODEL_PORTFOLIO_ID,
      },
    };
    const preview = await describeProposedWrite(call, ctx);

    expect(insertSpy).not.toHaveBeenCalled();
    expect(preview.name).toBe("add_account");
    expect(preview.summary).toMatch(/not available to this firm/i);
    // An FK failure renders no field diff.
    expect(preview.details).toBeUndefined();
  });

  it("surfaces the system-managed guard message on an isDefaultChecking update (no insert)", async () => {
    const insertSpy = vi.spyOn(db, "insert");
    // Discover a real isDefaultChecking account for this client at runtime
    // (branch-safe — ids differ per Neon branch).
    const [guarded] = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(
        and(
          eq(accounts.clientId, COOPER_CLIENT_ID),
          eq(accounts.isDefaultChecking, true),
        ),
      )
      .limit(1);
    expect(guarded, "expected an isDefaultChecking account fixture").toBeDefined();

    const call: ProposedWrite = {
      name: "update_account",
      // Changing the category of a system-managed cash account is guarded.
      args: { accountId: guarded.id, category: "taxable" },
    };
    const preview = await describeProposedWrite(call, ctx);

    expect(insertSpy).not.toHaveBeenCalled();
    expect(preview.name).toBe("update_account");
    expect(preview.summary).toMatch(/system-managed cash account/i);
    // The guard short-circuits before the diff.
    expect(preview.details).toBeUndefined();
  });

  it("degrades to the pure formatter when enrichment throws", async () => {
    vi.spyOn(accountCreateSchema, "safeParse").mockImplementation(() => {
      throw new Error("boom");
    });
    const call: ProposedWrite = {
      name: "add_account",
      args: { name: "Brokerage", category: "taxable" },
    };
    const preview = await describeProposedWrite(call, ctx);

    // Pure formatter result: named summary, NO enriched details.
    expect(preview.name).toBe("add_account");
    expect(preview.summary).toMatch(/Add account/i);
    expect(preview.details).toBeUndefined();
  });
});
