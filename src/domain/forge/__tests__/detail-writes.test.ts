// src/domain/forge/__tests__/detail-writes.test.ts
//
// Phase-3 expense WRITE tools (add_/update_/remove_expense). Mirrors the
// scenario-writes test structure: the cores are mocked, so this stays a pure
// unit asserting the tool's GATE → core → audit posture, NOT the core's DB work.
//
// The load-bearing assertions:
//   • gateAccess (requireOrgId + verifyClientAccess) runs BEFORE the core.
//   • actorId passed to the core is ctx.userId (the Clerk user), NOT firmId —
//     this LOCKS the SOC2 actor deviation from the plan sketch.
//   • forge.write_approved fires only on a real {ok:true} from the core.
//   • {ok:false} surfaces the core's error verbatim and skips write_approved.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db-helpers", () => ({ requireOrgId: vi.fn() }));
vi.mock("@/lib/clients/authz", () => ({ verifyClientAccess: vi.fn() }));
vi.mock("@/lib/clients/expenses-writes", () => ({
  createExpenseForClient: vi.fn(),
  updateExpenseForClient: vi.fn(),
  deleteExpenseForClient: vi.fn(),
}));
vi.mock("@/lib/clients/incomes-writes", () => ({
  createIncomeForClient: vi.fn(),
  updateIncomeForClient: vi.fn(),
  deleteIncomeForClient: vi.fn(),
}));
vi.mock("@/lib/clients/liabilities-writes", () => ({
  createLiabilityForClient: vi.fn(),
  updateLiabilityForClient: vi.fn(),
  deleteLiabilityForClient: vi.fn(),
}));
vi.mock("@/lib/clients/accounts-writes", () => ({
  createAccountForClient: vi.fn(),
  updateAccountForClient: vi.fn(),
  deleteAccountForClient: vi.fn(),
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
import {
  createIncomeForClient,
  updateIncomeForClient,
  deleteIncomeForClient,
} from "@/lib/clients/incomes-writes";
import {
  createLiabilityForClient,
  updateLiabilityForClient,
  deleteLiabilityForClient,
} from "@/lib/clients/liabilities-writes";
import {
  createAccountForClient,
  updateAccountForClient,
  deleteAccountForClient,
} from "@/lib/clients/accounts-writes";
import { recordAudit } from "@/lib/audit";
import { expenseCreateSchema } from "@/lib/schemas/expenses";
import { incomeCreateSchema } from "@/lib/schemas/incomes";
import { liabilityCreateSchema } from "@/lib/schemas/liabilities";
import { accountCreateSchema } from "@/lib/schemas/accounts";
import type { ForgeAuthContext } from "@/domain/forge/context";

const CTX: ForgeAuthContext = {
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
  vi.mocked(verifyClientAccess).mockResolvedValue({ ok: true, permission: "edit", firmId: "org_session", access: "own" });
  vi.mocked(recordAudit).mockResolvedValue(undefined);
});

describe("add_expense", () => {
  it("description says the advisor approves it on a card — call it directly", () => {
    expect(getTool("add_expense").description).toMatch(/approves it on a confirmation card.*call it directly/);
  });

  it("gates access BEFORE the core and passes actorId: ctx.userId (NOT firmId)", async () => {
    vi.mocked(createExpenseForClient).mockResolvedValue({
      ok: true,
      data: { id: "exp-1", name: "Vacation" } as never,
      resourceId: "exp-1",
    });
    await getTool("add_expense").invoke({ type: "discretionary", name: "Vacation", startYear: 2026, endYear: 2040 });

    expect(requireOrgId).toHaveBeenCalled();
    expect(verifyClientAccess).toHaveBeenCalledWith("client_1");
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

  it("audits forge.write_approved and returns the new id on success", async () => {
    vi.mocked(createExpenseForClient).mockResolvedValue({
      ok: true,
      data: { id: "exp-1", name: "Vacation" } as never,
      resourceId: "exp-1",
    });
    const result = await getTool("add_expense").invoke({
      type: "discretionary",
      name: "Vacation",
      startYear: 2026,
      endYear: 2040,
    });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "forge.write_approved",
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
      startYear: 2026,
      endYear: 2040,
      ownerEntityId: "e1",
      ownerAccountId: "a1",
    });
    expect(String(result)).toBe("Cannot set both ownerEntityId and ownerAccountId");
    expect(recordAudit).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: "forge.write_approved" }),
    );
  });

  it("rejects when verifyClientAccess fails WITHOUT calling the core", async () => {
    vi.mocked(verifyClientAccess).mockResolvedValue({ ok: false });
    const result = await getTool("add_expense").invoke({
      type: "discretionary",
      name: "x",
      startYear: 2026,
      endYear: 2040,
    });
    expect(String(result)).toMatch(/not found|access denied/i);
    expect(createExpenseForClient).not.toHaveBeenCalled();
  });

  it("accepts and forwards the five education fields to the write core", async () => {
    vi.mocked(createExpenseForClient).mockResolvedValue({
      ok: true,
      data: { id: "exp-1", name: "Emma — College" } as never,
      resourceId: "exp-1",
    });
    await getTool("add_expense").invoke({
      type: "education",
      name: "Emma — College",
      startYear: 2026,
      endYear: 2040,
      annualAmount: 45000,
      dedicatedAccountIds: ["acct-1"],
      payShortfallOutOfPocket: true,
      forFamilyMemberId: "fm-1",
      institutionName: "State University",
      institutionState: "TX",
    });
    expect(createExpenseForClient).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          dedicatedAccountIds: ["acct-1"],
          payShortfallOutOfPocket: true,
          forFamilyMemberId: "fm-1",
          institutionName: "State University",
          institutionState: "TX",
        }),
      }),
    );
  });
});

describe("update_expense", () => {
  it("description says the advisor approves it on a card — call it directly", () => {
    expect(getTool("update_expense").description).toMatch(/approves it on a confirmation card.*call it directly/);
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
        action: "forge.write_approved",
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
      expect.objectContaining({ action: "forge.write_approved" }),
    );
  });

  it("accepts and forwards the five education fields to the write core, including null to clear", async () => {
    vi.mocked(updateExpenseForClient).mockResolvedValue({
      ok: true,
      data: { id: "exp-1", name: "Emma — College" } as never,
      resourceId: "exp-1",
    });
    await getTool("update_expense").invoke({
      expenseId: "exp-1",
      dedicatedAccountIds: ["acct-1", "acct-2"],
      payShortfallOutOfPocket: false,
      // null clears a previously-set attribution/label — this is the
      // capability that would be lost if the tool schema dropped .nullable().
      forFamilyMemberId: null,
      institutionName: null,
      institutionState: "CA",
    });
    expect(updateExpenseForClient).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          dedicatedAccountIds: ["acct-1", "acct-2"],
          payShortfallOutOfPocket: false,
          forFamilyMemberId: null,
          institutionName: null,
          institutionState: "CA",
        }),
      }),
    );
  });
});

describe("remove_expense", () => {
  it("description says the advisor approves it on a card — call it directly", () => {
    expect(getTool("remove_expense").description).toMatch(/approves it on a confirmation card.*call it directly/);
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
        action: "forge.write_approved",
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
      expect.objectContaining({ action: "forge.write_approved" }),
    );
  });
});

describe("add_income", () => {
  it("description says the advisor approves it on a card — call it directly", () => {
    expect(getTool("add_income").description).toMatch(/approves it on a confirmation card.*call it directly/);
  });

  it("gates access BEFORE the core and passes actorId: ctx.userId (NOT firmId)", async () => {
    vi.mocked(createIncomeForClient).mockResolvedValue({
      ok: true,
      data: { id: "inc-1", name: "Salary" } as never,
      resourceId: "inc-1",
    });
    await getTool("add_income").invoke({ type: "salary", name: "Salary", startYear: 2026, endYear: 2040 });

    expect(requireOrgId).toHaveBeenCalled();
    expect(verifyClientAccess).toHaveBeenCalledWith("client_1");
    expect(createIncomeForClient).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: "client_1",
        firmId: "org_session",
        actorId: "u1",
      }),
    );

    const accessOrder = vi.mocked(verifyClientAccess).mock.invocationCallOrder[0];
    const writeOrder = vi.mocked(createIncomeForClient).mock.invocationCallOrder[0];
    expect(accessOrder).toBeLessThan(writeOrder);
  });

  it("audits forge.write_approved and returns the new id on success", async () => {
    vi.mocked(createIncomeForClient).mockResolvedValue({
      ok: true,
      data: { id: "inc-1", name: "Salary" } as never,
      resourceId: "inc-1",
    });
    const result = await getTool("add_income").invoke({ type: "salary", name: "Salary", startYear: 2026, endYear: 2040 });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "forge.write_approved",
        resourceType: "income",
        resourceId: "inc-1",
        metadata: expect.objectContaining({ tool: "add_income" }),
      }),
    );
    expect(String(result)).toContain("inc-1");
  });

  it("returns the core error verbatim and does NOT audit write_approved on {ok:false}", async () => {
    vi.mocked(createIncomeForClient).mockResolvedValue({
      ok: false,
      status: 400,
      error: "Cannot set both ownerEntityId and ownerAccountId",
    });
    const result = await getTool("add_income").invoke({
      type: "salary",
      name: "x",
      startYear: 2026,
      endYear: 2040,
      ownerEntityId: "e1",
      ownerAccountId: "a1",
    });
    expect(String(result)).toBe("Cannot set both ownerEntityId and ownerAccountId");
    expect(recordAudit).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: "forge.write_approved" }),
    );
  });

  it("rejects when verifyClientAccess fails WITHOUT calling the core", async () => {
    vi.mocked(verifyClientAccess).mockResolvedValue({ ok: false });
    const result = await getTool("add_income").invoke({ type: "salary", name: "x", startYear: 2026, endYear: 2040 });
    expect(String(result)).toMatch(/not found|access denied/i);
    expect(createIncomeForClient).not.toHaveBeenCalled();
  });
});

describe("update_income", () => {
  it("description says the advisor approves it on a card — call it directly", () => {
    expect(getTool("update_income").description).toMatch(/approves it on a confirmation card.*call it directly/);
  });

  it("passes incomeId + actorId: ctx.userId to the core and audits on success", async () => {
    vi.mocked(updateIncomeForClient).mockResolvedValue({
      ok: true,
      data: { id: "inc-1", name: "Salary" } as never,
      resourceId: "inc-1",
    });
    const result = await getTool("update_income").invoke({
      incomeId: "inc-1",
      annualAmount: 90000,
    });
    expect(updateIncomeForClient).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: "client_1",
        firmId: "org_session",
        actorId: "u1",
        incomeId: "inc-1",
      }),
    );
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "forge.write_approved",
        resourceType: "income",
        resourceId: "inc-1",
        metadata: expect.objectContaining({ tool: "update_income" }),
      }),
    );
    expect(String(result)).toContain("inc-1");
  });

  it("returns the core error verbatim on {ok:false}", async () => {
    vi.mocked(updateIncomeForClient).mockResolvedValue({
      ok: false,
      status: 404,
      error: "Income not found",
    });
    const result = await getTool("update_income").invoke({ incomeId: "missing" });
    expect(String(result)).toBe("Income not found");
    expect(recordAudit).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: "forge.write_approved" }),
    );
  });
});

describe("remove_income", () => {
  it("description says the advisor approves it on a card — call it directly", () => {
    expect(getTool("remove_income").description).toMatch(/approves it on a confirmation card.*call it directly/);
  });

  it("passes incomeId + actorId: ctx.userId to the core and audits on success", async () => {
    vi.mocked(deleteIncomeForClient).mockResolvedValue({
      ok: true,
      data: { id: "inc-1" },
      resourceId: "inc-1",
    });
    const result = await getTool("remove_income").invoke({ incomeId: "inc-1" });
    expect(deleteIncomeForClient).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: "client_1",
        firmId: "org_session",
        actorId: "u1",
        incomeId: "inc-1",
      }),
    );
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "forge.write_approved",
        resourceType: "income",
        resourceId: "inc-1",
        metadata: expect.objectContaining({ tool: "remove_income" }),
      }),
    );
    expect(String(result)).toContain("inc-1");
  });

  it("returns the core error verbatim on {ok:false}", async () => {
    vi.mocked(deleteIncomeForClient).mockResolvedValue({
      ok: false,
      status: 404,
      error: "Client not found",
    });
    const result = await getTool("remove_income").invoke({ incomeId: "missing" });
    expect(String(result)).toBe("Client not found");
    expect(recordAudit).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: "forge.write_approved" }),
    );
  });
});

describe("add_liability", () => {
  it("description says the advisor approves it on a card — call it directly", () => {
    expect(getTool("add_liability").description).toMatch(/approves it on a confirmation card.*call it directly/);
  });

  it("gates access BEFORE the core and passes actorId: ctx.userId (NOT firmId)", async () => {
    vi.mocked(createLiabilityForClient).mockResolvedValue({
      ok: true,
      data: { id: "liab-1", name: "Mortgage" } as never,
      resourceId: "liab-1",
    });
    await getTool("add_liability").invoke({
      name: "Mortgage",
      startYear: 2030,
      termMonths: 360,
    });

    expect(requireOrgId).toHaveBeenCalled();
    expect(verifyClientAccess).toHaveBeenCalledWith("client_1");
    expect(createLiabilityForClient).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: "client_1",
        firmId: "org_session",
        actorId: "u1",
      }),
    );

    const accessOrder = vi.mocked(verifyClientAccess).mock.invocationCallOrder[0];
    const writeOrder = vi.mocked(createLiabilityForClient).mock.invocationCallOrder[0];
    expect(accessOrder).toBeLessThan(writeOrder);
  });

  it("audits forge.write_approved and returns the new id on success", async () => {
    vi.mocked(createLiabilityForClient).mockResolvedValue({
      ok: true,
      data: { id: "liab-1", name: "Mortgage" } as never,
      resourceId: "liab-1",
    });
    const result = await getTool("add_liability").invoke({
      name: "Mortgage",
      startYear: 2030,
      termMonths: 360,
    });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "forge.write_approved",
        resourceType: "liability",
        resourceId: "liab-1",
        metadata: expect.objectContaining({ tool: "add_liability" }),
      }),
    );
    expect(String(result)).toContain("liab-1");
  });

  it("returns the core error verbatim and does NOT audit write_approved on {ok:false}", async () => {
    vi.mocked(createLiabilityForClient).mockResolvedValue({
      ok: false,
      status: 400,
      error: "A liability cannot have both a parent business and explicit owners",
    });
    const result = await getTool("add_liability").invoke({
      name: "x",
      startYear: 2030,
      termMonths: 360,
      parentAccountId: "a1",
      owners: [{ kind: "family_member", familyMemberId: "fm1", percent: 1 }],
    });
    expect(String(result)).toBe(
      "A liability cannot have both a parent business and explicit owners",
    );
    expect(recordAudit).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: "forge.write_approved" }),
    );
  });

  it("rejects when verifyClientAccess fails WITHOUT calling the core", async () => {
    vi.mocked(verifyClientAccess).mockResolvedValue({ ok: false });
    const result = await getTool("add_liability").invoke({
      name: "x",
      startYear: 2030,
      termMonths: 360,
    });
    expect(String(result)).toMatch(/not found|access denied/i);
    expect(createLiabilityForClient).not.toHaveBeenCalled();
  });
});

describe("update_liability", () => {
  it("description says the advisor approves it on a card — call it directly", () => {
    expect(getTool("update_liability").description).toMatch(/approves it on a confirmation card.*call it directly/);
  });

  it("passes liabilityId + actorId: ctx.userId to the core and audits on success", async () => {
    vi.mocked(updateLiabilityForClient).mockResolvedValue({
      ok: true,
      data: { id: "liab-1", name: "Mortgage" } as never,
      resourceId: "liab-1",
    });
    const result = await getTool("update_liability").invoke({
      liabilityId: "liab-1",
      balance: 200000,
    });
    expect(updateLiabilityForClient).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: "client_1",
        firmId: "org_session",
        actorId: "u1",
        liabilityId: "liab-1",
      }),
    );
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "forge.write_approved",
        resourceType: "liability",
        resourceId: "liab-1",
        metadata: expect.objectContaining({ tool: "update_liability" }),
      }),
    );
    expect(String(result)).toContain("liab-1");
  });

  it("returns the core error verbatim on {ok:false}", async () => {
    vi.mocked(updateLiabilityForClient).mockResolvedValue({
      ok: false,
      status: 404,
      error: "Liability not found",
    });
    const result = await getTool("update_liability").invoke({ liabilityId: "missing" });
    expect(String(result)).toBe("Liability not found");
    expect(recordAudit).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: "forge.write_approved" }),
    );
  });
});

describe("remove_liability", () => {
  it("description says the advisor approves it on a card — call it directly", () => {
    expect(getTool("remove_liability").description).toMatch(/approves it on a confirmation card.*call it directly/);
  });

  it("passes liabilityId + actorId: ctx.userId to the core and audits on success", async () => {
    vi.mocked(deleteLiabilityForClient).mockResolvedValue({
      ok: true,
      data: { id: "liab-1" },
      resourceId: "liab-1",
    });
    const result = await getTool("remove_liability").invoke({ liabilityId: "liab-1" });
    expect(deleteLiabilityForClient).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: "client_1",
        firmId: "org_session",
        actorId: "u1",
        liabilityId: "liab-1",
      }),
    );
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "forge.write_approved",
        resourceType: "liability",
        resourceId: "liab-1",
        metadata: expect.objectContaining({ tool: "remove_liability" }),
      }),
    );
    expect(String(result)).toContain("liab-1");
  });

  it("returns the core error verbatim on {ok:false}", async () => {
    vi.mocked(deleteLiabilityForClient).mockResolvedValue({
      ok: false,
      status: 404,
      error: "Liability not found",
    });
    const result = await getTool("remove_liability").invoke({ liabilityId: "missing" });
    expect(String(result)).toBe("Liability not found");
    expect(recordAudit).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: "forge.write_approved" }),
    );
  });
});

describe("add_account", () => {
  it("description says the advisor approves it on a card — call it directly", () => {
    expect(getTool("add_account").description).toMatch(/approves it on a confirmation card.*call it directly/);
  });

  it("gates access BEFORE the core and passes actorId: ctx.userId (NOT firmId)", async () => {
    vi.mocked(createAccountForClient).mockResolvedValue({
      ok: true,
      data: { id: "acct-1", name: "Brokerage" } as never,
      resourceId: "acct-1",
    });
    await getTool("add_account").invoke({ name: "Brokerage", category: "taxable" });

    expect(requireOrgId).toHaveBeenCalled();
    expect(verifyClientAccess).toHaveBeenCalledWith("client_1");
    expect(createAccountForClient).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: "client_1",
        firmId: "org_session",
        actorId: "u1",
      }),
    );

    const accessOrder = vi.mocked(verifyClientAccess).mock.invocationCallOrder[0];
    const writeOrder = vi.mocked(createAccountForClient).mock.invocationCallOrder[0];
    expect(accessOrder).toBeLessThan(writeOrder);
  });

  it("audits forge.write_approved and returns the new id on success", async () => {
    vi.mocked(createAccountForClient).mockResolvedValue({
      ok: true,
      data: { id: "acct-1", name: "Brokerage" } as never,
      resourceId: "acct-1",
    });
    const result = await getTool("add_account").invoke({
      name: "Brokerage",
      category: "taxable",
    });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "forge.write_approved",
        resourceType: "account",
        resourceId: "acct-1",
        metadata: expect.objectContaining({ tool: "add_account" }),
      }),
    );
    expect(String(result)).toContain("acct-1");
  });

  it("returns the core error verbatim and does NOT audit write_approved on {ok:false}", async () => {
    vi.mocked(createAccountForClient).mockResolvedValue({
      ok: false,
      status: 400,
      error: "parentAccountId must reference a business account",
    });
    const result = await getTool("add_account").invoke({
      name: "x",
      category: "taxable",
      parentAccountId: "a1",
    });
    expect(String(result)).toBe("parentAccountId must reference a business account");
    expect(recordAudit).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: "forge.write_approved" }),
    );
  });

  it("rejects when verifyClientAccess fails WITHOUT calling the core", async () => {
    vi.mocked(verifyClientAccess).mockResolvedValue({ ok: false });
    const result = await getTool("add_account").invoke({ name: "x", category: "taxable" });
    expect(String(result)).toMatch(/not found|access denied/i);
    expect(createAccountForClient).not.toHaveBeenCalled();
  });
});

describe("update_account", () => {
  it("description says the advisor approves it on a card — call it directly", () => {
    expect(getTool("update_account").description).toMatch(/approves it on a confirmation card.*call it directly/);
  });

  it("passes accountId + actorId: ctx.userId to the core and audits on success", async () => {
    vi.mocked(updateAccountForClient).mockResolvedValue({
      ok: true,
      data: { id: "acct-1", name: "Brokerage" } as never,
      resourceId: "acct-1",
    });
    const result = await getTool("update_account").invoke({
      accountId: "acct-1",
      value: 250000,
    });
    expect(updateAccountForClient).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: "client_1",
        firmId: "org_session",
        actorId: "u1",
        accountId: "acct-1",
      }),
    );
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "forge.write_approved",
        resourceType: "account",
        resourceId: "acct-1",
        metadata: expect.objectContaining({ tool: "update_account" }),
      }),
    );
    expect(String(result)).toContain("acct-1");
  });

  it("returns the core error verbatim on {ok:false}", async () => {
    vi.mocked(updateAccountForClient).mockResolvedValue({
      ok: false,
      status: 404,
      error: "Account not found",
    });
    const result = await getTool("update_account").invoke({ accountId: "missing" });
    expect(String(result)).toBe("Account not found");
    expect(recordAudit).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: "forge.write_approved" }),
    );
  });
});

describe("remove_account", () => {
  it("description says the advisor approves it on a card — call it directly", () => {
    expect(getTool("remove_account").description).toMatch(/approves it on a confirmation card.*call it directly/);
  });

  it("passes accountId + actorId: ctx.userId to the core and audits on success", async () => {
    vi.mocked(deleteAccountForClient).mockResolvedValue({
      ok: true,
      data: { id: "acct-1" },
      resourceId: "acct-1",
    });
    const result = await getTool("remove_account").invoke({ accountId: "acct-1" });
    expect(deleteAccountForClient).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: "client_1",
        firmId: "org_session",
        actorId: "u1",
        accountId: "acct-1",
      }),
    );
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "forge.write_approved",
        resourceType: "account",
        resourceId: "acct-1",
        metadata: expect.objectContaining({ tool: "remove_account" }),
      }),
    );
    expect(String(result)).toContain("acct-1");
  });

  it("returns the core error verbatim (e.g. system-managed guard) on {ok:false}", async () => {
    vi.mocked(deleteAccountForClient).mockResolvedValue({
      ok: false,
      status: 400,
      error: "This is a system-managed cash account and can't be deleted.",
    });
    const result = await getTool("remove_account").invoke({ accountId: "default-1" });
    expect(String(result)).toBe("This is a system-managed cash account and can't be deleted.");
    expect(recordAudit).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: "forge.write_approved" }),
    );
  });
});

// ── Every add_* tool declares what its write core REQUIRES ───────────────────
// Regression (2026-08-20): the add_* tool schemas marked startYear / endYear /
// termMonths .optional() even though the create schemas REQUIRE them. The model
// read the schema, omitted them, an approval card was raised and CONFIRMED, and
// only then did the core reject — "Invalid input; Invalid input: expected number,
// received undefined" — so the advisor approved a change that could never apply.
// A field the model must supply has to be required at the TOOL boundary, because
// that is what makes the model ask for it instead of proposing an unapplicable card.
//
// This asserts the invariant STRUCTURALLY rather than pinning today's field names:
// required(core create schema) ⊆ required(tool schema). Any future required field
// added to a core is caught here, on every add_* tool, without editing this test.
// (Zod v4 keeps `.shape` through .passthrough()/.superRefine(), and a field is
// "required" exactly when it cannot parse `undefined` — which correctly reads
// `.default(…)` as optional and `coerceToIntOptional.pipe(z.number())` as required.)
describe("add_* tools require what their write cores require", () => {
  type Shaped = { shape: Record<string, { safeParse(v: unknown): { success: boolean } }> };
  const requiredKeys = (schema: unknown) =>
    Object.entries((schema as Shaped).shape)
      .filter(([, field]) => !field.safeParse(undefined).success)
      .map(([key]) => key)
      .sort();

  const PAIRS = [
    ["add_expense", expenseCreateSchema],
    ["add_income", incomeCreateSchema],
    ["add_liability", liabilityCreateSchema],
    ["add_account", accountCreateSchema],
  ] as const;

  for (const [toolName, coreSchema] of PAIRS) {
    it(`${toolName} marks every field ${toolName.replace("add_", "")}CreateSchema requires as required`, () => {
      const declared = requiredKeys(getTool(toolName).schema);
      const needed = requiredKeys(coreSchema);
      expect(needed.length).toBeGreaterThan(0); // guard against an empty-shape false pass
      expect(needed.filter((k) => !declared.includes(k))).toEqual([]);
    });
  }

  // The reported repro, end to end: the advisor gave balance + rate + payment but
  // no term or start year. The call must die at the schema, BEFORE the core — that
  // ordering is what keeps an unapplicable approval card off the advisor's screen.
  it("add_liability rejects the reported student-loan call without reaching the core", async () => {
    await expect(
      getTool("add_liability").invoke({
        name: "Student loan",
        balance: 1000,
        interestRate: 0.032,
        monthlyPayment: 24,
      }),
    ).rejects.toThrow();
    expect(createLiabilityForClient).not.toHaveBeenCalled();
  });

  it("add_liability accepts that same call once startYear and termMonths are supplied", async () => {
    vi.mocked(createLiabilityForClient).mockResolvedValue({
      ok: true,
      data: { id: "liab-9", name: "Student loan" } as never,
      resourceId: "liab-9",
    });
    await getTool("add_liability").invoke({
      name: "Student loan",
      balance: 1000,
      interestRate: 0.032,
      monthlyPayment: 24,
      startYear: 2026,
      termMonths: 45,
    });
    expect(createLiabilityForClient).toHaveBeenCalled();
  });

  // Tightening CREATE must NOT leak into UPDATE — the update schemas are genuinely
  // partial, so a one-field patch has to keep working.
  it("update_liability still accepts a partial patch with no years or term", async () => {
    vi.mocked(updateLiabilityForClient).mockResolvedValue({
      ok: true,
      data: { id: "liab-1", name: "Student loan" } as never,
      resourceId: "liab-1",
    });
    await getTool("update_liability").invoke({ liabilityId: "liab-1", monthlyPayment: 50 });
    expect(updateLiabilityForClient).toHaveBeenCalled();
  });
});
