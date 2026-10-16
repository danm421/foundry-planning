// src/lib/imports/__tests__/reconcile-wiring.test.ts
//
// Task 7: proves annotateReconciliation is wired into the classic import's
// orchestrator (runImportMatching). The plan builder's runAssemble was the
// other one; it was deleted when Forge's plan builds became fact finder imports.
//
// The first describe block (verbatim from the task brief) documents the
// LEAK the merger has on its own: mergeExtractionResults does not dedupe
// INCOMES at all. It calls annotateReconciliation BY HAND, so it goes green
// the moment reconcile-compensation.ts exists (Task 6) and proves nothing
// about the wiring this task adds.
//
// INCOMES, specifically: mergeExtractionResults does clean its ACCOUNTS rows
// (accountRowsFor, see merge-account-rules.test.ts). Incomes it still merely
// concatenates, which is why reconciliation has to exist on this path.
//
// The second describe block is what actually proves the wiring: it drives
// runImportMatching itself (mocking only the DB, audit, and match pass — the
// real merger and the real annotateReconciliation run) and reads the
// annotation off the PERSISTED payload. Before Step 3/4's production edits,
// these are RED — the persisted payload carries two unmarked income rows for
// one job. After, exactly one is unmarked.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mergeExtractionResults } from "../merge";
import { annotateReconciliation, type FileMeta } from "../reconcile-compensation";
import type { ExtractionResult } from "@/lib/extraction/types";

function result(over: Partial<ExtractionResult> = {}): ExtractionResult {
  return {
    documentType: "pay_stub",
    fileName: "stub.pdf",
    extracted: {
      accounts: [], incomes: [], expenses: [], liabilities: [], entities: [],
      lifePolicies: [], wills: [], savings: [], goals: [],
    },
    warnings: [],
    promptVersion: "test",
    ...over,
  } as ExtractionResult;
}

const SALARY = {
  type: "salary" as const,
  name: "Rachel - Salary at The Mount Sinai Hospital",
  annualAmount: 239_550,
  owner: "client" as const,
  employer: "The Mount Sinai Hospital",
  sourceTaxYear: 2026,
  basis: "annualized" as const,
  recurrence: "recurring" as const,
};
const W2 = { ...SALARY, name: "W-2 Wages - The Mount Sinai Hospital", basis: "actual" as const };

const FILES: Record<string, FileMeta> = {
  stub1: { documentType: "pay_stub", fileName: "stub1.pdf" },
  stub2: { documentType: "pay_stub", fileName: "stub2.pdf" },
};

describe("reconciliation covers the classic payload builder", () => {
  it("CLASSIC path: two paystubs of one job leave exactly one importable row", () => {
    const merged = mergeExtractionResults([
      { fileId: "stub1", result: result({ extracted: { ...result().extracted, incomes: [SALARY] } }) },
      { fileId: "stub2", result: result({ extracted: { ...result().extracted, incomes: [SALARY] } }) },
    ]);
    expect(merged.incomes).toHaveLength(2); // no dedupe on this path at all
    const { payload } = annotateReconciliation(merged, FILES, 2026);
    expect(payload.incomes.filter((r) => !r.reconciliation)).toHaveLength(1);
  });

  it("CLASSIC path: a W-2 and a paystub for one job leave exactly one importable row", () => {
    const merged = mergeExtractionResults([
      { fileId: "stub1", result: result({ extracted: { ...result().extracted, incomes: [SALARY] } }) },
      { fileId: "stub2", result: result({ documentType: "tax_return", extracted: { ...result().extracted, incomes: [W2] } }) },
    ]);
    const { payload } = annotateReconciliation(merged, FILES, 2026);
    expect(payload.incomes.filter((r) => !r.reconciliation)).toHaveLength(1);
  });

  it("two genuinely different jobs both stay importable", () => {
    const other = { ...SALARY, employer: "Other Hospital", name: "Salary at Other" };
    const classic = annotateReconciliation(
      mergeExtractionResults([
        { fileId: "stub1", result: result({ extracted: { ...result().extracted, incomes: [SALARY] } }) },
        { fileId: "stub2", result: result({ extracted: { ...result().extracted, incomes: [other] } }) },
      ]), FILES, 2026,
    );
    expect(classic.payload.incomes.filter((r) => !r.reconciliation)).toHaveLength(2);
  });
});

// Real merger, real annotateReconciliation — only the DB, audit, and match
// pass are mocked. This is what lets these tests actually exercise the wiring
// the block above cannot.
const whereSpy = vi.fn(() => Promise.resolve());
const setSpy = vi.fn<(row: unknown) => { where: typeof whereSpy }>(() => ({ where: whereSpy }));
vi.mock("@/db", () => ({
  db: { update: vi.fn(() => ({ set: setSpy })) },
}));
const recordAudit = vi.fn<(args: unknown) => Promise<void>>(() => Promise.resolve());
vi.mock("@/lib/audit", () => ({ recordAudit: (a: unknown) => recordAudit(a) }));
// PASSTHROUGH: return the payload arg unchanged so rows keep whatever
// annotateReconciliation stamped on them.
vi.mock("@/lib/imports/match", () => ({ runMatchingPass: vi.fn(async (a: { payload: unknown }) => a.payload) }));

import { runImportMatching } from "../run-matching";

type PersistedIncomeRow = { reconciliation?: { supersededBy: string; reason: string } };
type PersistedCall = { payloadJson: { payload: { incomes: PersistedIncomeRow[] } } };

function duplicateJobFileResults(): Record<string, ExtractionResult> {
  return {
    stub1: result({ extracted: { ...result().extracted, incomes: [SALARY] } }),
    stub2: result({ documentType: "tax_return", extracted: { ...result().extracted, incomes: [W2] } }),
  };
}

describe("orchestrator wiring: the persisted payload carries reconciliation", () => {
  beforeEach(() => {
    setSpy.mockClear();
    whereSpy.mockClear();
    recordAudit.mockClear();
  });

  it("CLASSIC path (runImportMatching) persists exactly one unmarked income row for a W-2 + its own paystub", async () => {
    await runImportMatching({
      importId: "imp1",
      clientId: "c1",
      firmId: "org1",
      mode: "onboarding",
      scenarioId: null,
      fileResults: duplicateJobFileResults(),
    });

    expect(setSpy).toHaveBeenCalledTimes(1);
    const persisted = setSpy.mock.calls[0][0] as PersistedCall;
    const incomes = persisted.payloadJson.payload.incomes;
    expect(incomes).toHaveLength(2); // both rows kept, never dropped
    expect(incomes.filter((r) => !r.reconciliation)).toHaveLength(1);
    expect(incomes.filter((r) => r.reconciliation)).toHaveLength(1);
  });

  // Negative case for the test above: a bug that stamped exactly one
  // arbitrary income row (rather than correctly identifying duplicates)
  // would pass its "exactly one unmarked" assertion. This proves the wiring
  // doesn't just mark SOME row — it leaves genuinely distinct employers alone.
  it("CLASSIC path (runImportMatching): two distinct employers both survive unmarked", async () => {
    const other = { ...SALARY, employer: "Other Hospital", name: "Salary at Other" };

    await runImportMatching({
      importId: "imp3",
      clientId: "c1",
      firmId: "org1",
      mode: "onboarding",
      scenarioId: null,
      fileResults: {
        stub1: result({ extracted: { ...result().extracted, incomes: [SALARY] } }),
        stub2: result({ extracted: { ...result().extracted, incomes: [other] } }),
      },
    });

    expect(setSpy).toHaveBeenCalledTimes(1);
    const persisted = setSpy.mock.calls[0][0] as PersistedCall;
    const incomes = persisted.payloadJson.payload.incomes;
    expect(incomes).toHaveLength(2);
    expect(incomes.filter((r) => !r.reconciliation)).toHaveLength(2);
    expect(incomes.some((r) => r.reconciliation)).toBe(false);
  });
});
