// src/domain/copilot/__tests__/detail-writes.test.ts
//
// Phase-3 expense WRITE tools (add_/update_/remove_expense). Mirrors the
// scenario-writes test structure: the cores are mocked, so this stays a pure
// unit asserting the tool's GATE → core → audit posture, NOT the core's DB work.
//
// The load-bearing assertions:
//   • gateAccess (requireOrgId + verifyClientAccess) runs BEFORE the core.
//   • actorId passed to the core is ctx.userId (the Clerk user), NOT firmId —
//     this LOCKS the SOC2 actor deviation from the plan sketch.
//   • copilot.write_approved fires only on a real {ok:true} from the core.
//   • {ok:false} surfaces the core's error verbatim and skips write_approved.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db-helpers", () => ({ requireOrgId: vi.fn() }));
vi.mock("@/lib/clients/authz", () => ({ verifyClientAccess: vi.fn() }));
vi.mock("@/lib/clients/expenses-writes", () => ({
  createExpenseForClient: vi.fn(),
  updateExpenseForClient: vi.fn(),
  deleteExpenseForClient: vi.fn(),
}));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));

import { buildDetailWriteTools } from "../tools/detail-writes";
import { requireOrgId } from "@/lib/db-helpers";
import { verifyClientAccess } from "@/lib/clients/authz";
import {
  createExpenseForClient,
  updateExpenseForClient,
  deleteExpenseForClient,
} from "@/lib/clients/expenses-writes";
import { recordAudit } from "@/lib/audit";
import type { CopilotAuthContext } from "@/domain/copilot/context";

const CTX: CopilotAuthContext = {
  userId: "u1",
  firmId: "org_session",
  clientId: "client_1",
  scenarioId: "s1",
};

function getTool(name: string) {
  const t = buildDetailWriteTools({ ctx: CTX, conversationId: "c1" }).find(
    (x) => x.name === name,
  );
  if (!t) throw new Error(`tool ${name} not built`);
  return t;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireOrgId).mockResolvedValue("org_session");
  vi.mocked(verifyClientAccess).mockResolvedValue(true);
  vi.mocked(recordAudit).mockResolvedValue(undefined);
});

describe("add_expense", () => {
  it('description ends with "Requires human approval."', () => {
    expect(getTool("add_expense").description).toMatch(/Requires human approval\.$/);
  });

  it("gates access BEFORE the core and passes actorId: ctx.userId (NOT firmId)", async () => {
    vi.mocked(createExpenseForClient).mockResolvedValue({
      ok: true,
      data: { id: "exp-1", name: "Vacation" } as never,
      resourceId: "exp-1",
    });
    await getTool("add_expense").invoke({ type: "discretionary", name: "Vacation" });

    expect(requireOrgId).toHaveBeenCalled();
    expect(verifyClientAccess).toHaveBeenCalledWith("client_1", "org_session");
    expect(createExpenseForClient).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: "client_1",
        firmId: "org_session",
        actorId: "u1",
      }),
    );

    const accessOrder = vi.mocked(verifyClientAccess).mock.invocationCallOrder[0];
    const writeOrder = vi.mocked(createExpenseForClient).mock.invocationCallOrder[0];
    expect(accessOrder).toBeLessThan(writeOrder);
  });

  it("audits copilot.write_approved and returns the new id on success", async () => {
    vi.mocked(createExpenseForClient).mockResolvedValue({
      ok: true,
      data: { id: "exp-1", name: "Vacation" } as never,
      resourceId: "exp-1",
    });
    const result = await getTool("add_expense").invoke({
      type: "discretionary",
      name: "Vacation",
    });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "copilot.write_approved",
        resourceId: "exp-1",
        metadata: expect.objectContaining({ tool: "add_expense" }),
      }),
    );
    expect(String(result)).toContain("exp-1");
  });

  it("returns the core error verbatim and does NOT audit write_approved on {ok:false}", async () => {
    vi.mocked(createExpenseForClient).mockResolvedValue({
      ok: false,
      status: 400,
      error: "Cannot set both ownerEntityId and ownerAccountId",
    });
    const result = await getTool("add_expense").invoke({
      type: "discretionary",
      name: "x",
      ownerEntityId: "e1",
      ownerAccountId: "a1",
    });
    expect(String(result)).toBe("Cannot set both ownerEntityId and ownerAccountId");
    expect(recordAudit).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: "copilot.write_approved" }),
    );
  });

  it("rejects when verifyClientAccess fails WITHOUT calling the core", async () => {
    vi.mocked(verifyClientAccess).mockResolvedValue(false);
    const result = await getTool("add_expense").invoke({
      type: "discretionary",
      name: "x",
    });
    expect(String(result)).toMatch(/not found|access denied/i);
    expect(createExpenseForClient).not.toHaveBeenCalled();
  });
});

describe("update_expense", () => {
  it('description ends with "Requires human approval."', () => {
    expect(getTool("update_expense").description).toMatch(/Requires human approval\.$/);
  });

  it("passes expenseId + actorId: ctx.userId to the core and audits on success", async () => {
    vi.mocked(updateExpenseForClient).mockResolvedValue({
      ok: true,
      data: { id: "exp-1", name: "Vacation" } as never,
      resourceId: "exp-1",
    });
    const result = await getTool("update_expense").invoke({
      expenseId: "exp-1",
      annualAmount: 5000,
    });
    expect(updateExpenseForClient).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: "client_1",
        firmId: "org_session",
        actorId: "u1",
        expenseId: "exp-1",
      }),
    );
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "copilot.write_approved",
        resourceId: "exp-1",
        metadata: expect.objectContaining({ tool: "update_expense" }),
      }),
    );
    expect(String(result)).toContain("exp-1");
  });

  it("returns the core error verbatim on {ok:false}", async () => {
    vi.mocked(updateExpenseForClient).mockResolvedValue({
      ok: false,
      status: 404,
      error: "Expense not found",
    });
    const result = await getTool("update_expense").invoke({ expenseId: "missing" });
    expect(String(result)).toBe("Expense not found");
    expect(recordAudit).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: "copilot.write_approved" }),
    );
  });
});

describe("remove_expense", () => {
  it('description ends with "Requires human approval."', () => {
    expect(getTool("remove_expense").description).toMatch(/Requires human approval\.$/);
  });

  it("passes expenseId + actorId: ctx.userId to the core and audits on success", async () => {
    vi.mocked(deleteExpenseForClient).mockResolvedValue({
      ok: true,
      data: { id: "exp-1" },
      resourceId: "exp-1",
    });
    const result = await getTool("remove_expense").invoke({ expenseId: "exp-1" });
    expect(deleteExpenseForClient).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: "client_1",
        firmId: "org_session",
        actorId: "u1",
        expenseId: "exp-1",
      }),
    );
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "copilot.write_approved",
        resourceId: "exp-1",
        metadata: expect.objectContaining({ tool: "remove_expense" }),
      }),
    );
    expect(String(result)).toContain("exp-1");
  });

  it("returns the core error verbatim (e.g. default-row guard) on {ok:false}", async () => {
    vi.mocked(deleteExpenseForClient).mockResolvedValue({
      ok: false,
      status: 400,
      error: "Default living-expense rows cannot be deleted.",
    });
    const result = await getTool("remove_expense").invoke({ expenseId: "default-1" });
    expect(String(result)).toBe("Default living-expense rows cannot be deleted.");
    expect(recordAudit).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: "copilot.write_approved" }),
    );
  });
});
