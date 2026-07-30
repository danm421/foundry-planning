// src/lib/imports/assemble/__tests__/run-assemble-planner-version.test.ts
//
// `PLANNER_VERSION` shipped with a comment promising that "downstream
// telemetry/debugging can tell which prompt produced a given proposal" while
// having ZERO readers — the constant was bumped twice against a contract
// nothing implemented. This file pins the contract now that `runAssemble`
// actually writes it, to both `payloadJson.assemble.plannerVersion` and the
// `import.assemble.run` audit metadata.
//
// The load-bearing case is ABSENCE. Stamping unconditionally would attribute a
// purely deterministic payload to a prompt that contributed nothing to it, and
// that reads as a real provenance record while being a lie — worse than the
// unread constant this replaced. `not.toHaveProperty` is deliberate over
// `toBeUndefined`: it fails on a key present-but-undefined, which is what a
// careless `plannerVersion: applied ? V : undefined` would leave behind.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PlanningDecisions } from "@/lib/imports/planner/types";
import type { runPlanner } from "@/lib/imports/planner/run-planner";
import { PLANNER_VERSION } from "@/lib/imports/planner/prompt";

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

// NOT the empty decisions object: an all-empty proposal still applies cleanly,
// so a stamp keyed on "did the fold succeed" would pass either way. Moving
// retirementAge to 64/"document" makes the applied-ness independently visible
// (mode "new" + known.retirementAge 65 would otherwise read 65/"build_request").
const DECISIONS: PlanningDecisions = {
  version: 1,
  assumptions: {
    retirementAge: { value: 64, provenance: "document", reason: "Stated in the profile table." },
  },
  savings: [], socialSecurity: [], goals: [], incomeTiming: [], questions: [], notes: [],
};

function persistedAssemble() {
  const persisted = setSpy.mock.calls[0][0] as {
    payloadJson: { assemble: Record<string, unknown> };
  };
  return persisted.payloadJson.assemble;
}

function persistedPlanBasics() {
  const persisted = setSpy.mock.calls[0][0] as {
    payloadJson: {
      payload: { planBasics?: { retirementAge: { value: number | null; provenance: string } } };
    };
  };
  return persisted.payloadJson.payload.planBasics;
}

function auditMetadata() {
  const call = recordAudit.mock.calls[0][0] as { metadata: Record<string, unknown> };
  return call.metadata;
}

/** Planner runs and its proposal applies cleanly (real `applyDecisions`). */
async function assembleWithPlanner() {
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

/** No document text and no file text -> `runAssemble` never reaches the planner. */
async function assembleWithoutPlanner() {
  const runPlannerFn = vi.fn<typeof runPlanner>(async () => DECISIONS);
  const res = await runAssemble({
    importId: "imp1", clientId: "cli1", firmId: "firm1", mode: "new", scenarioId: "sc1",
    fileResults: {},
    known: { retirementAge: 65, lifeExpectancy: 92, primaryDob: "1972-06-14" },
    hasSpouse: false,
    runPlannerFn,
  });
  return { res, runPlannerFn };
}

describe("runAssemble — PLANNER_VERSION provenance stamp", () => {
  beforeEach(() => {
    setSpy.mockClear();
    whereSpy.mockClear();
    recordAudit.mockClear();
  });

  it("keeps the date-dot-serial format the bump instruction assumes", () => {
    // Two prompts that differ must sort and compare as distinct strings; the
    // format is what makes a bump legible rather than an arbitrary token.
    expect(PLANNER_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
  });

  describe("when the planner proposed and the fold applied it", () => {
    it("actually reached the planner (assert the instrument)", async () => {
      const { runPlannerFn } = await assembleWithPlanner();
      expect(runPlannerFn).toHaveBeenCalledTimes(1);
    });

    it("actually applied the proposal (so the stamp is not vacuous)", async () => {
      await assembleWithPlanner();
      expect(persistedPlanBasics()?.retirementAge).toMatchObject({
        value: 64, provenance: "document",
      });
    });

    it("stamps the persisted assemble state", async () => {
      await assembleWithPlanner();
      expect(persistedAssemble().plannerVersion).toBe(PLANNER_VERSION);
    });

    it("stamps the audit metadata", async () => {
      await assembleWithPlanner();
      expect(auditMetadata().plannerVersion).toBe(PLANNER_VERSION);
    });

    it("returns the stamp to the caller, not only to the DB", async () => {
      const { res } = await assembleWithPlanner();
      expect(res.assemble.plannerVersion).toBe(PLANNER_VERSION);
    });
  });

  describe("when the planner never ran", () => {
    it("did not reach the planner (assert the instrument)", async () => {
      const { runPlannerFn } = await assembleWithoutPlanner();
      expect(runPlannerFn).not.toHaveBeenCalled();
    });

    it("omits the key from the persisted assemble state entirely", async () => {
      await assembleWithoutPlanner();
      expect(persistedAssemble()).not.toHaveProperty("plannerVersion");
    });

    it("omits the key from the audit metadata entirely", async () => {
      await assembleWithoutPlanner();
      expect(auditMetadata()).not.toHaveProperty("plannerVersion");
    });

    it("still persists and audits the import", async () => {
      await assembleWithoutPlanner();
      expect(setSpy).toHaveBeenCalledTimes(1);
      expect(recordAudit).toHaveBeenCalledTimes(1);
    });
  });
});
