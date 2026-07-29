import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ExtractionResult } from "@/lib/extraction/types";
import type { PlanningDecisions } from "@/lib/imports/planner/types";
import type { runPlanner } from "@/lib/imports/planner/run-planner";

// The call signature is carried on vi.fn's type argument rather than a
// named implementation parameter (`(cond) => ...`) so `.mock.calls[0][0]`
// stays typed without an unused-var lint warning on an unused parameter
// name — the sibling run-assemble.test.ts's `_cond`/`_v`/`_args` params are
// pre-existing debt; this new file doesn't repeat it.
const whereSpy = vi.fn<(cond: unknown) => Promise<void>>(() => Promise.resolve());
const setSpy = vi.fn<(v: unknown) => { where: typeof whereSpy }>(() => ({ where: whereSpy }));
vi.mock("@/db", () => ({
  db: { update: vi.fn(() => ({ set: setSpy })) },
}));
const recordAudit = vi.fn<(a: unknown) => Promise<void>>(() => Promise.resolve());
vi.mock("@/lib/audit", () => ({ recordAudit: (a: unknown) => recordAudit(a) }));
// PASSTHROUGH: return the payload arg unchanged so rows keep their {kind:"new"} seeds.
vi.mock("@/lib/imports/match", () => ({ runMatchingPass: vi.fn(async (a: { payload: unknown }) => a.payload) }));

import { runAssemble } from "../run-assemble";

function er(fileName: string, extracted: Partial<ExtractionResult["extracted"]>): ExtractionResult {
  return {
    documentType: "account_statement", fileName, promptVersion: "test", warnings: [],
    extracted: { accounts: [], incomes: [], expenses: [], liabilities: [], entities: [], lifePolicies: [], wills: [], savings: [], goals: [], ...extracted },
  };
}

// R3/R6: an ExtractionResult carrying the already-redacted `text` extract.ts
// (R2) now persists on the single-pass path — used to prove runAssemble
// derives the planner's inputs from fileResults when args.documentText is
// absent.
function erWithText(fileName: string, text: string): ExtractionResult {
  return { ...er(fileName, {}), text };
}

const EMPTY_DECISIONS: PlanningDecisions = {
  version: 1, assumptions: {}, savings: [], socialSecurity: [],
  goals: [], incomeTiming: [], questions: [], notes: [],
};

type RunPlannerFn = typeof runPlanner;

function persistedPayload() {
  const persisted = setSpy.mock.calls[0][0] as {
    payloadJson: {
      payload: {
        planBasics?: { retirementAge: { value: number | null; provenance: string } };
      };
    };
  };
  return persisted.payloadJson.payload;
}

describe("runAssemble + planner", () => {
  beforeEach(() => {
    setSpy.mockClear();
    whereSpy.mockClear();
    recordAudit.mockClear();
  });

  it("applies planner decisions to the persisted payload", async () => {
    const decisions: PlanningDecisions = {
      ...EMPTY_DECISIONS,
      assumptions: {
        retirementAge: { value: 64, provenance: "document", reason: "Stated in the profile table." },
      },
    };
    const runPlannerFn = vi.fn<RunPlannerFn>(async () => decisions);

    await runAssemble({
      importId: "imp1", clientId: "cli1", firmId: "firm1", mode: "new", scenarioId: "sc1",
      fileResults: {},
      hasSpouse: false,
      documentText: "Client Profile: retiring at 64...",
      runPlannerFn,
    });

    expect(runPlannerFn).toHaveBeenCalledTimes(1);
    const calledWith = runPlannerFn.mock.calls[0][0];
    expect(calledWith.documentText).toBe("Client Profile: retiring at 64...");
    // R3 stub: estimatePia is Task 17's real export; today it always returns 0.
    expect(calledWith.estimatePia({ highestAnnualSalary: 100000, yearsEmployed: 10, futureYears: 5 })).toBe(0);

    expect(persistedPayload().planBasics?.retirementAge).toEqual({
      value: 64, provenance: "document", reason: "Stated in the profile table.",
    });
  });

  it("completes with deterministic behaviour when the planner returns null", async () => {
    const runPlannerFn = vi.fn<RunPlannerFn>(async () => null);

    const res = await runAssemble({
      importId: "imp2", clientId: "cli1", firmId: "firm1", mode: "new", scenarioId: "sc1",
      fileResults: {},
      known: { retirementAge: 65, lifeExpectancy: 92, primaryDob: "1972-06-14" },
      hasSpouse: false,
      documentText: "unreadable garbage",
      runPlannerFn,
    });

    expect(runPlannerFn).toHaveBeenCalledTimes(1);
    // The deterministic value (mode "new" -> provenance "build_request") must
    // survive untouched, not merely "assemble resolved without throwing".
    expect(persistedPayload().planBasics?.retirementAge).toEqual({
      value: 65, provenance: "build_request",
    });
    expect(res.assemble.version).toBe(1);
  });

  it("completes when the planner rejects", async () => {
    const runPlannerFn = vi.fn<RunPlannerFn>(async () => {
      throw new Error("Azure timeout");
    });

    const res = await runAssemble({
      importId: "imp3", clientId: "cli1", firmId: "firm1", mode: "new", scenarioId: "sc1",
      fileResults: {},
      known: { retirementAge: 65, lifeExpectancy: 92, primaryDob: "1972-06-14" },
      hasSpouse: false,
      documentText: "some text",
      runPlannerFn,
    });

    expect(runPlannerFn).toHaveBeenCalledTimes(1);
    // Same decisive check as the null case: the deterministic value survives
    // a rejected planner call, not just "the promise resolved".
    expect(persistedPayload().planBasics?.retirementAge).toEqual({
      value: 65, provenance: "build_request",
    });
    expect(res.assemble.version).toBe(1);
  });

  it("skips the planner when no document text was supplied", async () => {
    const runPlannerFn = vi.fn<RunPlannerFn>(async () => EMPTY_DECISIONS);

    await runAssemble({
      importId: "imp4", clientId: "cli1", firmId: "firm1", mode: "new", scenarioId: "sc1",
      fileResults: {},
      known: { retirementAge: 65, lifeExpectancy: 92, primaryDob: "1972-06-14" },
      hasSpouse: false,
      runPlannerFn,
    });

    expect(runPlannerFn).not.toHaveBeenCalled();
  });

  it("de-duplicates merged questions by id, with the deterministic question winning, and questionCount reflects the merge", async () => {
    // Baseline: no documentText, so no planner questions at all. mode "new"
    // with no known values on a bare payload deterministically produces
    // q:primary_dob (identity), q:retirement_age and q:filing_status
    // (assumption) — see the sibling run-assemble.test.ts for the same fixture.
    const baseline = await runAssemble({
      importId: "imp5", clientId: "cli1", firmId: "firm1", mode: "new", scenarioId: "sc1",
      fileResults: { f1: er("stmt.pdf", {}) },
      hasSpouse: false,
    });
    const baselineIds = baseline.assemble.questions.map((q) => q.id);
    expect(baselineIds).toContain("q:primary_dob");
    const baselineCount = baseline.assemble.questions.length;
    setSpy.mockClear();
    whereSpy.mockClear();
    recordAudit.mockClear();

    // Planner proposes a question colliding with the deterministic
    // q:primary_dob id, plus a genuinely new one.
    const decisions: PlanningDecisions = {
      ...EMPTY_DECISIONS,
      questions: [
        { id: "q:primary_dob", field: "client.primaryDob", prompt: "Planner's own (overridden) phrasing." },
        { id: "q:planner_new", field: "client.somethingElse", prompt: "A genuinely new planner question." },
      ],
    };
    const runPlannerFn = vi.fn<RunPlannerFn>(async () => decisions);

    const res = await runAssemble({
      importId: "imp6", clientId: "cli1", firmId: "firm1", mode: "new", scenarioId: "sc1",
      fileResults: { f1: er("stmt.pdf", {}) },
      hasSpouse: false,
      documentText: "doc text",
      runPlannerFn,
    });

    // Exactly one new question was added (q:planner_new); the colliding
    // q:primary_dob did not duplicate.
    expect(res.assemble.questions).toHaveLength(baselineCount + 1);
    const ids = res.assemble.questions.map((q) => q.id);
    expect(ids.filter((id) => id === "q:primary_dob")).toHaveLength(1);
    expect(ids).toContain("q:planner_new");

    // The deterministic question wins the collision: kind stays "identity"
    // (the planner's version would have mapped to kind "missing").
    const primaryDobQuestion = res.assemble.questions.find((q) => q.id === "q:primary_dob");
    expect(primaryDobQuestion?.kind).toBe("identity");
    expect(primaryDobQuestion?.prompt).not.toBe("Planner's own (overridden) phrasing.");

    // questionCount reflects the MERGED list, not the pre-merge deterministic count.
    expect(res.questionCount).toBe(res.assemble.questions.length);
    expect(res.questionCount).toBe(baselineCount + 1);

    // The audit metadata's questionCount must also reflect the merge.
    expect(recordAudit).toHaveBeenCalledTimes(1);
    const auditMeta = recordAudit.mock.calls[0][0] as { metadata: { questionCount: number } };
    expect(auditMeta.metadata.questionCount).toBe(baselineCount + 1);
  });

  // ── Fix round 1 — Step 5 (owner ruled option (a)) ──────────────────────
  // Task 15 shipped with `args.documentText` always undefined in production
  // (Step 5 was skipped, see task-15-report.md) — the planner never ran, and
  // every test above proved that only via injection. These four prove the
  // NEW derive-from-fileResults path (R3/R4) actually fires.

  it("derives documentText from fileResults and actually runs the planner when no explicit documentText is passed", async () => {
    const decisions: PlanningDecisions = {
      ...EMPTY_DECISIONS,
      assumptions: {
        retirementAge: { value: 64, provenance: "document", reason: "Stated in the profile table." },
      },
    };
    const runPlannerFn = vi.fn<RunPlannerFn>(async () => decisions);

    await runAssemble({
      importId: "imp7", clientId: "cli1", firmId: "firm1", mode: "new", scenarioId: "sc1",
      // NOTE: no `documentText` arg — this must be DERIVED from fileResults'
      // persisted `text` (extract.ts R2), the whole point of this fix round.
      fileResults: { f1: erWithText("profile.pdf", "Client Profile: retiring at 64...") },
      hasSpouse: false,
      runPlannerFn,
    });

    expect(runPlannerFn).toHaveBeenCalledTimes(1);
    const calledWith = runPlannerFn.mock.calls[0][0];
    expect(calledWith.documentText).toContain("Client Profile: retiring at 64...");

    // Not just "called" — the decision it returned must actually land in
    // the persisted payload, same decisive check as the injected-text test.
    expect(persistedPayload().planBasics?.retirementAge).toEqual({
      value: 64, provenance: "document", reason: "Stated in the profile table.",
    });
  });

  it("concatenates MULTIPLE fileResults into documentText in deterministic (Object.entries) file order", async () => {
    const runPlannerFn = vi.fn<RunPlannerFn>(async () => EMPTY_DECISIONS);

    await runAssemble({
      importId: "imp8", clientId: "cli1", firmId: "firm1", mode: "new", scenarioId: "sc1",
      fileResults: {
        f1: erWithText("first.pdf", "First file body."),
        f2: erWithText("second.pdf", "Second file body."),
      },
      hasSpouse: false,
      runPlannerFn,
    });

    expect(runPlannerFn).toHaveBeenCalledTimes(1);
    const calledWith = runPlannerFn.mock.calls[0][0];
    const firstIdx = calledWith.documentText.indexOf("First file body.");
    const secondIdx = calledWith.documentText.indexOf("Second file body.");
    expect(firstIdx).toBeGreaterThanOrEqual(0);
    expect(secondIdx).toBeGreaterThan(firstIdx);
    expect(calledWith.documentText).toContain("first.pdf");
    expect(calledWith.documentText).toContain("second.pdf");
  });

  it("rowCount counts planner-added rows (R4) — fails if rowCount reverts to countRows(annotated)", async () => {
    // A non-education goal decision (Rule 4 in applyDecisions) adds an
    // "other" expense row that exists ONLY on plannerPayload/assembledPayload,
    // never on `annotated` (fileResults is empty, so annotated has zero rows).
    const decisions: PlanningDecisions = {
      ...EMPTY_DECISIONS,
      goals: [
        {
          kind: "one_time",
          name: { value: "New Roof", provenance: "document", reason: "Stated in the notes." },
          annualAmount: { value: 20000, provenance: "document", reason: "Stated in the notes." },
          startYear: { value: 2030, provenance: "document", reason: "Stated in the notes." },
          endYear: { value: 2030, provenance: "document", reason: "Stated in the notes." },
          dedicatedAccountNames: [],
        },
      ],
    };
    const runPlannerFn = vi.fn<RunPlannerFn>(async () => decisions);

    const res = await runAssemble({
      importId: "imp9", clientId: "cli1", firmId: "firm1", mode: "new", scenarioId: "sc1",
      fileResults: {},
      hasSpouse: false,
      documentText: "New roof needed, $20,000 in 2030.",
      runPlannerFn,
    });

    expect(res.rowCount).toBe(1);
  });

  it("rowCount counts a planner EDUCATION-goal decision, which lands in goals.education and not in expenses", async () => {
    // The sibling test above uses kind "one_time", which applyDecisions turns
    // into an `expenses` row (buildExpenseRow) — already counted. kind
    // "education" instead becomes a `goals.education` entry
    // (deriveEducationGoal), which countRows omitted entirely, so a planner
    // education goal moved rowCount by zero. fileResults is empty, so every
    // other payload array is empty and the only row that can exist is this one.
    const decisions: PlanningDecisions = {
      ...EMPTY_DECISIONS,
      goals: [
        {
          kind: "education",
          name: { value: "Ava college", provenance: "document", reason: "Stated in the notes." },
          annualAmount: { value: 30000, provenance: "document", reason: "Stated in the notes." },
          startYear: { value: 2035, provenance: "document", reason: "Stated in the notes." },
          endYear: { value: 2038, provenance: "document", reason: "Stated in the notes." },
          dedicatedAccountNames: [],
        },
      ],
    };
    const runPlannerFn = vi.fn<RunPlannerFn>(async () => decisions);

    const res = await runAssemble({
      importId: "imp11", clientId: "cli1", firmId: "firm1", mode: "new", scenarioId: "sc1",
      fileResults: {},
      hasSpouse: false,
      documentText: "Ava starts college in 2035, $30,000 a year for four years.",
      runPlannerFn,
    });

    // Prove the row landed where we think it did, so this test cannot pass for
    // the wrong reason (e.g. the goal silently becoming an expense instead).
    const persisted = persistedPayload() as {
      goals?: { education: unknown[] };
      expenses: unknown[];
    };
    expect(persisted.goals?.education).toHaveLength(1);
    expect(persisted.expenses).toHaveLength(0);
    expect(res.rowCount).toBe(1);
  });

  it("existing explicit documentText still takes precedence over fileResults-derived text", async () => {
    const runPlannerFn = vi.fn<RunPlannerFn>(async () => EMPTY_DECISIONS);

    await runAssemble({
      importId: "imp10", clientId: "cli1", firmId: "firm1", mode: "new", scenarioId: "sc1",
      // fileResults carries text too, but the explicit documentText below
      // must win — Task 19's fixture harness relies on this precedence.
      fileResults: { f1: erWithText("ignored.pdf", "This should NOT reach the planner.") },
      hasSpouse: false,
      documentText: "Explicit text wins.",
      runPlannerFn,
    });

    expect(runPlannerFn).toHaveBeenCalledTimes(1);
    const calledWith = runPlannerFn.mock.calls[0][0];
    expect(calledWith.documentText).toBe("Explicit text wins.");
    expect(calledWith.documentText).not.toContain("This should NOT reach the planner.");
  });
});
