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
import type { CopilotAuthContext } from "@/domain/copilot/state";
import { db } from "@/db";

const COOPER_CLIENT_ID = "877a9532-f8ea-49b0-9db7-aadd64fab82a";
const COOPER_FIRM_ID = "org_3CitTEIe8PJa1BVYw7LnEjkiP9r";

const HAS_DB = !!process.env.DATABASE_URL;

const ctx: CopilotAuthContext = {
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
