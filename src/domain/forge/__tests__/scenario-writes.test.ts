// src/domain/forge/__tests__/scenario-writes.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db-helpers", () => ({ requireOrgId: vi.fn() }));
vi.mock("@/lib/clients/authz", () => ({ verifyClientAccess: vi.fn() }));
vi.mock("@/lib/scenario/create-with-clone", () => ({ createScenarioWithClone: vi.fn() }));
vi.mock("@/lib/scenario/changes-writer", () => ({
  applyEntityAdd: vi.fn(), applyEntityEdit: vi.fn(), applyEntityRemove: vi.fn(), revertChange: vi.fn(),
}));
vi.mock("@/lib/scenario/snapshot", () => ({ createSnapshot: vi.fn() }));
vi.mock("@/lib/scenario/promote-to-base", () => ({ promoteScenarioToBase: vi.fn() }));
vi.mock("@/lib/scenario/load-projection-for-ref", () => ({ loadProjectionForRef: vi.fn() }));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));
vi.mock("@/db", () => ({
  db: { select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => Promise.resolve([])) })) })) },
}));

import { buildScenarioWriteTools } from "../tools/scenario-writes";
import { requireOrgId } from "@/lib/db-helpers";
import { verifyClientAccess } from "@/lib/clients/authz";
import { createScenarioWithClone } from "@/lib/scenario/create-with-clone";
import { applyEntityAdd, applyEntityEdit, applyEntityRemove, revertChange } from "@/lib/scenario/changes-writer";
import { createSnapshot } from "@/lib/scenario/snapshot";
import { promoteScenarioToBase } from "@/lib/scenario/promote-to-base";
import { loadProjectionForRef } from "@/lib/scenario/load-projection-for-ref";
import { recordAudit } from "@/lib/audit";
import { db } from "@/db";
import type { ForgeAuthContext } from "@/domain/forge/context";

const CTX: ForgeAuthContext = { userId: "user_1", firmId: "org_session", clientId: "client_1", scenarioId: "scenario_1" };
function getTool(name: string) {
  const t = buildScenarioWriteTools({ ctx: CTX, conversationId: "conv_1" }).find((x) => x.name === name);
  if (!t) throw new Error(`tool ${name} not built`);
  return t;
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireOrgId).mockResolvedValue("org_session");
  vi.mocked(verifyClientAccess).mockResolvedValue(true);
  vi.mocked(recordAudit).mockResolvedValue(undefined);
});

describe("create_scenario", () => {
  it('description ends with "Requires human approval."', () => {
    expect(getTool("create_scenario").description).toMatch(/Requires human approval\.$/);
  });
  it("re-derives firmId via requireOrgId + verifyClientAccess BEFORE the write", async () => {
    vi.mocked(createScenarioWithClone).mockResolvedValue({ scenario: { id: "s-new", name: "Roth ladder" } as never });
    await getTool("create_scenario").invoke({ name: "Roth ladder", copyFrom: "base" });
    expect(requireOrgId).toHaveBeenCalled();
    expect(verifyClientAccess).toHaveBeenCalledWith("client_1", "org_session");
    const accessOrder = vi.mocked(verifyClientAccess).mock.invocationCallOrder[0];
    const writeOrder = vi.mocked(createScenarioWithClone).mock.invocationCallOrder[0];
    expect(accessOrder).toBeLessThan(writeOrder);
  });
  it("rejects when verifyClientAccess fails (cross-firm clientId)", async () => {
    vi.mocked(verifyClientAccess).mockResolvedValue(false);
    const result = await getTool("create_scenario").invoke({ name: "X", copyFrom: "base" });
    expect(String(result)).toMatch(/not found|access denied|cannot/i);
    expect(createScenarioWithClone).not.toHaveBeenCalled();
  });
  it("goes through createScenarioWithClone (not raw db) and emits copilot.write_approved", async () => {
    vi.mocked(createScenarioWithClone).mockResolvedValue({ scenario: { id: "s-new", name: "Roth ladder" } as never });
    const result = await getTool("create_scenario").invoke({ name: "Roth ladder", copyFrom: "base" });
    expect(createScenarioWithClone).toHaveBeenCalledWith(expect.objectContaining({ clientId: "client_1", name: "Roth ladder", source: { kind: "base" } }));
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "copilot.write_approved", clientId: "client_1", firmId: "org_session" }));
    expect(String(result)).toContain("s-new");
  });
});

describe("propose_changes", () => {
  // The batch runs inside db.transaction; the toggle-group mint + every change
  // share this tx so a mid-batch failure rolls them all back as one unit.
  let txMock: { insert: ReturnType<typeof vi.fn> };
  beforeEach(() => {
    const insertChain = {
      values: vi.fn(() => ({ returning: vi.fn(() => Promise.resolve([{ id: "tg-new" }])) })),
    };
    txMock = { insert: vi.fn(() => insertChain) };
    // db.select (the client-pin scenario lookup) returns a matching row.
    vi.mocked(db.select as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn(() => ({ where: vi.fn(() => Promise.resolve([{ id: "scenario_1", clientId: "client_1" }])) })),
    } as never);
    // db.transaction runs the callback with txMock and PROPAGATES a rejection,
    // exactly as a real transaction rolls back when the callback throws.
    (db as unknown as { transaction: ReturnType<typeof vi.fn> }).transaction = vi.fn(
      async (cb: (tx: unknown) => Promise<unknown>) => cb(txMock),
    );
  });

  it('description ends with "Requires human approval."', () => {
    expect(getTool("propose_changes").description).toMatch(/Requires human approval\.$/);
  });

  it("rejects when verifyClientAccess fails", async () => {
    vi.mocked(verifyClientAccess).mockResolvedValue(false);
    const result = await getTool("propose_changes").invoke({
      scenarioId: "scenario_1",
      groupName: "g",
      changes: [{ opType: "edit", targetKind: "income", targetId: "inc1", desiredFields: { annualAmount: 1 } }],
    });
    expect(String(result)).toMatch(/not found|access denied/i);
    expect(applyEntityEdit).not.toHaveBeenCalled();
  });

  it("routes each change through the changes-writer under one minted toggle group", async () => {
    vi.mocked(applyEntityAdd).mockResolvedValue({ targetId: "a-new" });
    vi.mocked(applyEntityEdit).mockResolvedValue(undefined);
    vi.mocked(applyEntityRemove).mockResolvedValue(undefined);
    await getTool("propose_changes").invoke({
      scenarioId: "scenario_1",
      groupName: "Roth ladder",
      changes: [
        { opType: "add", targetKind: "roth_conversion", targetId: "rc-1", entity: { id: "rc-1" } },
        { opType: "edit", targetKind: "plan_settings", targetId: "plan_settings", desiredFields: { ssClaimAgePrimary: 70 } },
        { opType: "remove", targetKind: "income", targetId: "inc-old" },
      ],
    });
    // All three writers fired, each carrying the minted toggleGroupId "tg-new"
    // AND the shared batch transaction (so they commit/roll back as one unit).
    expect(applyEntityAdd).toHaveBeenCalledWith(expect.objectContaining({ scenarioId: "scenario_1", firmId: "org_session", toggleGroupId: "tg-new", tx: txMock }));
    expect(applyEntityEdit).toHaveBeenCalledWith(expect.objectContaining({ desiredFields: { ssClaimAgePrimary: 70 }, toggleGroupId: "tg-new", tx: txMock }));
    expect(applyEntityRemove).toHaveBeenCalledWith(expect.objectContaining({ targetId: "inc-old", toggleGroupId: "tg-new", tx: txMock }));
  });

  it("rolls back and does NOT audit write_approved when a change fails mid-batch", async () => {
    // A mid-batch failure (e.g. constraint violation, or the model emitting an
    // unrecognized targetKind that the writer rejects) must roll back the whole
    // batch — no orphaned toggle group, no half-applied proposal — and skip the
    // write_approved audit, so the audit trail never claims a write that didn't
    // persist. Audit ownership: tools own write_approved (real success only).
    vi.mocked(applyEntityEdit).mockRejectedValue(new Error("constraint violation"));
    const result = await getTool("propose_changes").invoke({
      scenarioId: "scenario_1",
      groupName: "g",
      changes: [{ opType: "edit", targetKind: "income", targetId: "inc1", desiredFields: { annualAmount: 1 } }],
    });
    expect(String(result)).toMatch(/sorry/i);
    expect(recordAudit).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: "copilot.write_approved" }),
    );
  });

  it("emits copilot.write_approved after the batch", async () => {
    vi.mocked(applyEntityEdit).mockResolvedValue(undefined);
    await getTool("propose_changes").invoke({
      scenarioId: "scenario_1",
      groupName: "g",
      changes: [{ opType: "edit", targetKind: "income", targetId: "inc1", desiredFields: { annualAmount: 1 } }],
    });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "copilot.write_approved", metadata: expect.objectContaining({ tool: "propose_changes" }) }),
    );
  });
});

describe("revert_change", () => {
  beforeEach(() => {
    // db.select(scenarios) must confirm the scenario belongs to ctx.clientId
    // before revertChange is called (the client-pin guard).
    vi.mocked(db.select as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn(() => ({ where: vi.fn(() => Promise.resolve([{ id: "scenario_1" }])) })),
    } as never);
  });

  it('description ends with "Requires human approval."', () => {
    expect(getTool("revert_change").description).toMatch(/Requires human approval\.$/);
  });

  it("rejects when verifyClientAccess fails", async () => {
    vi.mocked(verifyClientAccess).mockResolvedValue(false);
    const result = await getTool("revert_change").invoke({
      scenarioId: "scenario_1", targetKind: "income", targetId: "inc1", opType: "edit",
    });
    expect(String(result)).toMatch(/not found|access denied/i);
    expect(revertChange).not.toHaveBeenCalled();
  });

  it("rejects when the scenario is not owned by ctx.clientId (cross-client)", async () => {
    // Scenario exists in the firm but belongs to a DIFFERENT client → pin select
    // returns no row, so we must bail before touching revertChange.
    vi.mocked(db.select as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn(() => ({ where: vi.fn(() => Promise.resolve([])) })),
    } as never);
    const result = await getTool("revert_change").invoke({
      scenarioId: "scenario_other", targetKind: "income", targetId: "inc1", opType: "edit",
    });
    expect(String(result)).toMatch(/not found/i);
    expect(revertChange).not.toHaveBeenCalled();
  });

  it("routes through revertChange (not raw db) and audits write_approved", async () => {
    vi.mocked(revertChange).mockResolvedValue(undefined);
    await getTool("revert_change").invoke({
      scenarioId: "scenario_1", targetKind: "income", targetId: "inc1", opType: "edit",
    });
    expect(revertChange).toHaveBeenCalledWith({
      scenarioId: "scenario_1", firmId: "org_session", targetKind: "income", targetId: "inc1", opType: "edit",
    });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "copilot.write_approved", metadata: expect.objectContaining({ tool: "revert_change" }) }),
    );
  });
});

describe("compare_and_snapshot", () => {
  beforeEach(() => {
    vi.mocked(loadProjectionForRef).mockResolvedValue({
      tree: {} as never, result: {} as never, scenarioName: "x", isDoNothing: false,
    });
    vi.mocked(createSnapshot).mockResolvedValue({ id: "snap-new", name: "Base vs Roth" } as never);
  });

  it('description ends with "Requires human approval."', () => {
    expect(getTool("compare_and_snapshot").description).toMatch(/Requires human approval\.$/);
  });

  it("rejects when verifyClientAccess fails", async () => {
    vi.mocked(verifyClientAccess).mockResolvedValue(false);
    const result = await getTool("compare_and_snapshot").invoke({ name: "n", leftRef: "base", rightRef: "s2" });
    expect(String(result)).toMatch(/not found|access denied/i);
    expect(createSnapshot).not.toHaveBeenCalled();
  });

  it("loads BOTH refs then snapshots through createSnapshot with server-derived scope", async () => {
    await getTool("compare_and_snapshot").invoke({ name: "Base vs Roth", leftRef: "base", rightRef: "s2" });
    expect(loadProjectionForRef).toHaveBeenCalledTimes(2);
    expect(loadProjectionForRef).toHaveBeenCalledWith("client_1", "org_session", { kind: "scenario", id: "base", toggleState: {} });
    expect(loadProjectionForRef).toHaveBeenCalledWith("client_1", "org_session", { kind: "scenario", id: "s2", toggleState: {} });
    expect(createSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: "client_1", firmId: "org_session", userId: "user_1",
        name: "Base vs Roth", sourceKind: "manual",
        leftRef: { kind: "scenario", id: "base", toggleState: {} },
        rightRef: { kind: "scenario", id: "s2", toggleState: {} },
      }),
    );
  });

  it("audits write_approved", async () => {
    await getTool("compare_and_snapshot").invoke({ name: "n", leftRef: "base", rightRef: "s2" });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "copilot.write_approved", metadata: expect.objectContaining({ tool: "compare_and_snapshot" }) }),
    );
  });
});

describe("promote_to_base", () => {
  // Default: the client-pin lookup returns a NON-base scenario owned by this client.
  function pinReturns(rows: unknown[]) {
    vi.mocked(db.select as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn(() => ({ where: vi.fn(() => Promise.resolve(rows)) })),
    } as never);
  }
  beforeEach(() => {
    pinReturns([{ id: "scenario_1", name: "Roth ladder", isBaseCase: false }]);
    vi.mocked(promoteScenarioToBase).mockResolvedValue({
      snapshotId: "snap-old-base", deletedScenarioCount: 2, counts: {}, notes: { kept: 0, dropped: 0 },
    });
  });

  it('description ends with "Requires human approval."', () => {
    expect(getTool("promote_to_base").description).toMatch(/Requires human approval\.$/);
  });

  it("REFUSES when the target is already the base case (and does NOT call promoteScenarioToBase)", async () => {
    pinReturns([{ id: "scenario_1", name: "Base", isBaseCase: true }]);
    const result = await getTool("promote_to_base").invoke({ scenarioId: "scenario_1" });
    expect(String(result)).toMatch(/already the base|refus/i);
    expect(promoteScenarioToBase).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: "copilot.write_approved" }),
    );
  });

  it("promotes a non-base scenario and audits exactly one write_approved with the real resourceId", async () => {
    const result = await getTool("promote_to_base").invoke({ scenarioId: "scenario_1" });
    expect(promoteScenarioToBase).toHaveBeenCalledTimes(1);
    expect(promoteScenarioToBase).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: "client_1",
        firmId: "org_session",
        scenarioId: "scenario_1",
        scenarioName: "Roth ladder",
        toggleState: {},
        userId: "user_1",
        dateLabel: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      }),
    );
    const approvedCalls = vi
      .mocked(recordAudit)
      .mock.calls.filter(([a]) => a.action === "copilot.write_approved");
    expect(approvedCalls).toHaveLength(1);
    expect(approvedCalls[0][0]).toMatchObject({
      action: "copilot.write_approved",
      resourceType: "scenario",
      resourceId: "scenario_1",
      clientId: "client_1",
      firmId: "org_session",
    });
    expect(String(result)).toContain("snap-old-base");
  });

  it("rejects when verifyClientAccess fails (no promote, no audit)", async () => {
    vi.mocked(verifyClientAccess).mockResolvedValue(false);
    const result = await getTool("promote_to_base").invoke({ scenarioId: "scenario_1" });
    expect(String(result)).toMatch(/not found|access denied/i);
    expect(promoteScenarioToBase).not.toHaveBeenCalled();
  });
});
