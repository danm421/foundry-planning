import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ExtractionResult } from "@/lib/extraction/types";

const whereSpy = vi.fn((_cond: unknown) => Promise.resolve());
const setSpy = vi.fn((_v: unknown) => ({ where: whereSpy }));
vi.mock("@/db", () => ({
  db: { update: vi.fn(() => ({ set: setSpy })) },
}));
const recordAudit = vi.fn((_args: unknown) => Promise.resolve());
vi.mock("@/lib/audit", () => ({ recordAudit: (a: unknown) => recordAudit(a) }));
// PASSTHROUGH: return the payload arg unchanged so rows keep their {kind:"new"} seeds.
vi.mock("@/lib/imports/match", () => ({ runMatchingPass: vi.fn(async (a: { payload: unknown }) => a.payload) }));

import { runAssemble } from "../run-assemble";

function er(fileName: string, extracted: Partial<ExtractionResult["extracted"]>): ExtractionResult {
  return {
    documentType: "account_statement", fileName, promptVersion: "test", warnings: [],
    extracted: { accounts: [], incomes: [], expenses: [], liabilities: [], entities: [], lifePolicies: [], wills: [], ...extracted },
  };
}

describe("runAssemble", () => {
  beforeEach(() => { setSpy.mockClear(); whereSpy.mockClear(); recordAudit.mockClear(); });

  it("merges, gap-fills, generates questions, persists payload+assemble, audits", async () => {
    const res = await runAssemble({
      importId: "imp1", clientId: "cli1", firmId: "firm1", mode: "new", scenarioId: "sc1",
      fileResults: { f1: er("stmt.pdf", { accounts: [{ name: "401k", custodian: "Fidelity", accountNumberLast4: "1234", value: 100, category: "retirement" }] }) },
      hasSpouse: false,
    });
    expect(res.assemble.version).toBe(1);
    expect(res.assemble.mergedFileCount).toBe(1);
    // new prospect w/ no DOB → gap-fill assumptions + a primary_dob question
    expect(res.assemble.assumptions.length).toBeGreaterThan(0);
    expect(res.rowCount).toBe(1);
    // persisted shape
    expect(setSpy).toHaveBeenCalledTimes(1);
    const persisted = setSpy.mock.calls[0][0] as { payloadJson: { payload: unknown; assemble: unknown; fileResults: unknown } };
    expect(persisted.payloadJson.assemble).toBeTruthy();
    expect(persisted.payloadJson.fileResults).toBeTruthy();
    // audit
    expect(recordAudit).toHaveBeenCalledTimes(1);
    expect((recordAudit.mock.calls[0][0] as { action: string }).action).toBe("import.assemble.run");
  });

  it("generates a primary_dob identity question for a new prospect with no known DOB", async () => {
    const res = await runAssemble({
      importId: "imp2", clientId: "cli1", firmId: "firm1", mode: "new", scenarioId: "sc1",
      fileResults: { f1: er("stmt.pdf", {}) },
      hasSpouse: false,
    });
    expect(res.questionCount).toBe(res.assemble.questions.length);
    expect(res.assemble.questions.some((q) => q.id === "q:primary_dob")).toBe(true);
  });

  it("collapses a 3-file same-entity merge into exactly one conflict warning and one question with a unique id (FIX 6)", async () => {
    const res = await runAssemble({
      importId: "imp4", clientId: "cli1", firmId: "firm1", mode: "existing", scenarioId: "sc1",
      known: { retirementAge: 65, lifeExpectancy: 92, filingStatus: "single", primaryDob: "1980-01-01" },
      fileResults: {
        f1: er("jan.pdf", { accounts: [{ name: "Schwab Brokerage", custodian: "Schwab", accountNumberLast4: "9911", value: 100000 }] }),
        f2: er("feb.pdf", { accounts: [{ name: "Schwab Brokerage", custodian: "Schwab", accountNumberLast4: "9911", value: 100200 }] }),
        f3: er("mar.pdf", { accounts: [{ name: "Schwab Brokerage", custodian: "Schwab", accountNumberLast4: "9911", value: 100400 }] }),
      },
      hasSpouse: false,
    });

    const persisted = setSpy.mock.calls[0][0] as {
      payloadJson: { payload: { warnings: string[] } };
    };
    const mergeWarnings = persisted.payloadJson.payload.warnings.filter((w) =>
      w.includes("Merged duplicate account"),
    );
    // Before FIX 6, 3 files carrying the same account produced TWO warnings
    // ("...seen in 2 documents." then "...seen in 3 documents."), which
    // conflictQuestions turned into two questions sharing the same slugified
    // id (duplicate React keys / colliding answers[q.id] in the card).
    expect(mergeWarnings).toHaveLength(1);
    expect(mergeWarnings[0]).toMatch(/seen in 3 documents/);

    const conflictQuestions = res.assemble.questions.filter((q) => q.kind === "conflict");
    expect(conflictQuestions).toHaveLength(1);
    const ids = res.assemble.questions.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("computes rowCount across all row kinds and updates the correct import row", async () => {
    const res = await runAssemble({
      importId: "imp3", clientId: "cli1", firmId: "firm1", mode: "existing", scenarioId: "sc1",
      known: { retirementAge: 65, lifeExpectancy: 92, filingStatus: "single", primaryDob: "1980-01-01" },
      fileResults: {
        f1: er("stmt.pdf", {
          accounts: [{ name: "401k", custodian: "Fidelity", accountNumberLast4: "1234", value: 100, category: "retirement" }],
          incomes: [{ name: "Salary", annualAmount: 1000 }],
        }),
      },
      hasSpouse: false,
    });
    expect(res.rowCount).toBe(2);
    expect(whereSpy).toHaveBeenCalledTimes(1);
  });
});

describe("runAssemble planBasics", () => {
  beforeEach(() => { setSpy.mockClear(); whereSpy.mockClear(); recordAudit.mockClear(); });

  it("populates planBasics from the known client values", async () => {
    const result = await runAssemble({
      importId: "imp5", clientId: "cli1", firmId: "firm1", mode: "new", scenarioId: "sc1",
      fileResults: {},
      known: { retirementAge: 65, lifeExpectancy: 92, primaryDob: "1972-06-14" },
      hasSpouse: false,
      taxReturn: null,
    });

    expect(result.assemble.planBasics?.retirementAge).toEqual({
      value: 65,
      provenance: "build_request",
    });
  });

  it("passes the stored return through to the spending derivation", async () => {
    const result = await runAssemble({
      importId: "imp6", clientId: "cli1", firmId: "firm1", mode: "new", scenarioId: "sc1",
      fileResults: {},
      known: { retirementAge: 65, lifeExpectancy: 92, primaryDob: "1972-06-14" },
      hasSpouse: false,
      taxReturn: { taxYear: 2025, agi: 100000, totalTax: 10000 },
    });

    expect(result.assemble.planBasics?.currentLivingSpending.value).toBe(90000);
  });

  it("omits planBasics when retirementAge/lifeExpectancy are not yet known", async () => {
    const result = await runAssemble({
      importId: "imp7", clientId: "cli1", firmId: "firm1", mode: "new", scenarioId: "sc1",
      fileResults: {},
      hasSpouse: false,
      taxReturn: null,
    });

    expect(result.assemble.planBasics).toBeUndefined();
  });
});
