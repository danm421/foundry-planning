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
});
