// src/domain/copilot/__tests__/scenario-writes.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db-helpers", () => ({ requireOrgId: vi.fn() }));
vi.mock("@/lib/clients/authz", () => ({ verifyClientAccess: vi.fn() }));
vi.mock("@/lib/scenario/create-with-clone", () => ({ createScenarioWithClone: vi.fn() }));
vi.mock("@/lib/scenario/changes-writer", () => ({
  applyEntityAdd: vi.fn(), applyEntityEdit: vi.fn(), applyEntityRemove: vi.fn(), revertChange: vi.fn(),
}));
vi.mock("@/lib/scenario/snapshot", () => ({ createSnapshot: vi.fn() }));
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
import { loadProjectionForRef } from "@/lib/scenario/load-projection-for-ref";
import { recordAudit } from "@/lib/audit";
import { db } from "@/db";
import type { CopilotAuthContext } from "@/domain/copilot/context";

const CTX: CopilotAuthContext = { userId: "user_1", firmId: "org_session", clientId: "client_1", scenarioId: "scenario_1" };
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
  beforeEach(() => {
    // db.insert(scenarioToggleGroups) must succeed and return a minted id.
    const insertChain = {
      values: vi.fn(() => ({ returning: vi.fn(() => Promise.resolve([{ id: "tg-new" }])) })),
    };
    // Re-mock db with both select (scenario lookup) and insert (toggle group).
    vi.mocked(db.select as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn(() => ({ where: vi.fn(() => Promise.resolve([{ id: "scenario_1", clientId: "client_1" }])) })),
    } as never);
    (db as unknown as { insert: ReturnType<typeof vi.fn> }).insert = vi.fn(() => insertChain);
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
    // All three writers fired, each carrying the minted toggleGroupId "tg-new".
    expect(applyEntityAdd).toHaveBeenCalledWith(expect.objectContaining({ scenarioId: "scenario_1", firmId: "org_session", toggleGroupId: "tg-new" }));
    expect(applyEntityEdit).toHaveBeenCalledWith(expect.objectContaining({ desiredFields: { ssClaimAgePrimary: 70 }, toggleGroupId: "tg-new" }));
    expect(applyEntityRemove).toHaveBeenCalledWith(expect.objectContaining({ targetId: "inc-old", toggleGroupId: "tg-new" }));
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
