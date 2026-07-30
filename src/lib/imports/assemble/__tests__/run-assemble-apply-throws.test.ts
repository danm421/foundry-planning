// src/lib/imports/assemble/__tests__/run-assemble-apply-throws.test.ts
//
// R2 half 2 (whole-branch review, C2). `runPlanner` documents itself as NEVER
// THROWS, and `run-assemble.ts` wraps the `plan({...})` call in
// `.catch(() => null)` — but `applyDecisions`, the fold that CONSUMES the
// planner's output, sat OUTSIDE that catch. So a throw inside the fold
// propagated straight out of `runAssemble` and took plan-building down, which
// is exactly the failure the never-throw contract exists to prevent.
//
// Half 1 (`accountKey(row.destinationAccountName ?? "")`) fixes today's known
// throw; this file pins the wrapper, which is what makes the contract true for
// the NEXT unvalidated field. `applyDecisions` is mocked to throw for that
// reason: the guarantee must not depend on which field is currently unsafe.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PlanningDecisions } from "@/lib/imports/planner/types";
import type { runPlanner } from "@/lib/imports/planner/run-planner";

const whereSpy = vi.fn<(cond: unknown) => Promise<void>>(() => Promise.resolve());
const setSpy = vi.fn<(v: unknown) => { where: typeof whereSpy }>(() => ({ where: whereSpy }));
vi.mock("@/db", () => ({
  db: { update: vi.fn(() => ({ set: setSpy })) },
}));
const recordAudit = vi.fn<(a: unknown) => Promise<void>>(() => Promise.resolve());
vi.mock("@/lib/audit", () => ({ recordAudit: (a: unknown) => recordAudit(a) }));
// PASSTHROUGH: return the payload arg unchanged so rows keep their {kind:"new"} seeds.
vi.mock("@/lib/imports/match", () => ({ runMatchingPass: vi.fn(async (a: { payload: unknown }) => a.payload) }));

const applyDecisions = vi.fn(() => {
  // The literal shape of the C2 throw, so the message the test degrades on is
  // the one production would have seen.
  throw new TypeError("Cannot read properties of undefined (reading 'toLowerCase')");
});
vi.mock("@/lib/imports/planner/apply-decisions", () => ({
  applyDecisions: () => applyDecisions(),
}));

import { runAssemble } from "../run-assemble";

const EMPTY_DECISIONS: PlanningDecisions = {
  version: 1, assumptions: {}, savings: [], socialSecurity: [],
  goals: [], incomeTiming: [], questions: [], notes: [],
};

/** Decisions that WOULD move retirementAge, so a silent success is detectable. */
const DECISIONS: PlanningDecisions = {
  ...EMPTY_DECISIONS,
  assumptions: {
    retirementAge: { value: 64, provenance: "document", reason: "Stated in the profile table." },
  },
  questions: [{ id: "q:planner_only", field: "x", prompt: "Planner question." }],
  notes: ["A planner note."],
};

function persistedPayload() {
  const persisted = setSpy.mock.calls[0][0] as {
    payloadJson: {
      payload: {
        warnings: string[];
        planBasics?: { retirementAge: { value: number | null; provenance: string } };
      };
    };
  };
  return persisted.payloadJson.payload;
}

function persistedAssemble() {
  const persisted = setSpy.mock.calls[0][0] as {
    payloadJson: { assemble: Record<string, unknown> };
  };
  return persisted.payloadJson.assemble;
}

async function assembleWithThrowingFold() {
  const runPlannerFn = vi.fn<typeof runPlanner>(async () => DECISIONS);
  const res = await runAssemble({
    importId: "imp1", clientId: "cli1", firmId: "firm1", mode: "new", scenarioId: "sc1",
    fileResults: {},
    known: { retirementAge: 65, lifeExpectancy: 92, primaryDob: "1972-06-14" },
    hasSpouse: false,
    documentText: "some document text",
    runPlannerFn,
  });
  return { res, runPlannerFn };
}

describe("runAssemble — applyDecisions throws", () => {
  beforeEach(() => {
    setSpy.mockClear();
    whereSpy.mockClear();
    recordAudit.mockClear();
    applyDecisions.mockClear();
  });

  it("resolves instead of rejecting", async () => {
    await expect(assembleWithThrowingFold()).resolves.toBeTruthy();
  });

  it("actually reached the fold (assert the instrument, not just the subject)", async () => {
    // Without this, every assertion below would also pass if the planner had
    // simply been skipped and `applyDecisions` never called at all.
    const { runPlannerFn } = await assembleWithThrowingFold();
    expect(runPlannerFn).toHaveBeenCalledTimes(1);
    expect(applyDecisions).toHaveBeenCalledTimes(1);
  });

  it("persists the DETERMINISTIC payload, not a half-applied one", async () => {
    await assembleWithThrowingFold();
    // mode "new" + known.retirementAge 65 -> provenance "build_request". The
    // planner proposed 64/"document"; if any part of the fold had landed, this
    // would read 64.
    expect(persistedPayload().planBasics?.retirementAge).toEqual({
      value: 65, provenance: "build_request",
    });
  });

  it("records a warning on the payload so the failure is not silent", async () => {
    await assembleWithThrowingFold();
    expect(persistedPayload().warnings).toContain(
      "The planning reasoner's proposal could not be applied; the plan was assembled from the document as extracted.",
    );
  });

  it("drops the planner's questions and notes rather than half-merging them", async () => {
    const { res } = await assembleWithThrowingFold();
    expect(res.assemble.notes).toEqual([]);
    expect(res.assemble.questions.map((q) => q.id)).not.toContain("q:planner_only");
    // The deterministic questions still come through — degrading the planner
    // must not degrade the deterministic pass.
    expect(res.assemble.questions.length).toBeGreaterThan(0);
  });

  it("still persists and audits the import", async () => {
    const { res } = await assembleWithThrowingFold();
    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(recordAudit).toHaveBeenCalledTimes(1);
    expect(res.assemble.version).toBe(1);
  });

  // The third branch of the PLANNER_VERSION stamp, and the only one this file
  // can reach: the planner DID propose, so a stamp keyed on "was the planner
  // attempted" would fire here — but the fold threw and the persisted payload
  // is the deterministic one, which no prompt shaped. Attributing it to
  // `PLANNER_VERSION` would make the provenance record actively wrong.
  // See run-assemble-planner-version.test.ts for the ran/never-ran branches.
  it("does not stamp plannerVersion when the fold threw", async () => {
    await assembleWithThrowingFold();
    expect(persistedAssemble()).not.toHaveProperty("plannerVersion");
  });

  it("does not stamp plannerVersion into the audit metadata either", async () => {
    await assembleWithThrowingFold();
    const call = recordAudit.mock.calls[0][0] as { metadata: Record<string, unknown> };
    expect(call.metadata).not.toHaveProperty("plannerVersion");
  });
});
