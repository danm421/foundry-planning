// src/domain/mcp/__tests__/scenario-writes.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  saveSolverScenario: vi.fn(),
  loadEffectiveTree: vi.fn(),
  assertScenarioOfClient: vi.fn(),
  firmClaudeWritesEnabled: vi.fn(),
  verifyClientAccessFor: vi.fn(),
  recordAudit: vi.fn(),
}));

vi.mock("@/lib/solver/save-scenario", () => ({ saveSolverScenario: h.saveSolverScenario }));
vi.mock("@/lib/scenario/loader", () => ({ loadEffectiveTree: h.loadEffectiveTree }));
vi.mock("../whatif-jobs", () => ({ assertScenarioOfClient: h.assertScenarioOfClient }));
vi.mock("@/lib/firm-settings", () => ({ firmClaudeWritesEnabled: h.firmClaudeWritesEnabled }));
vi.mock("@/lib/clients/authz", () => ({ verifyClientAccessFor: h.verifyClientAccessFor }));
vi.mock("@/lib/audit", () => ({ recordAudit: h.recordAudit }));
vi.mock("@/lib/rate-limit", () => ({
  checkMcpRateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 1, reset: 0 }),
}));

import { scenarioWriteTools, SAVE_FAILED_MESSAGE } from "../tools/scenario-writes";
import { WRITE_DISABLED_MESSAGE } from "../define-tool";
import { WhatIfValidationError } from "@/lib/whatif/errors";
import type { McpPrincipal } from "@/lib/mcp/principal";
import type { ResolutionContext } from "@/lib/projection/resolve-entity";
import type { SolverMutation } from "@/lib/solver/types";
import { IDS, whatIfTree } from "@/lib/whatif/__tests__/fixtures";

const principal: McpPrincipal = { userId: "u1", orgId: "org_1", orgRole: "org:member", scopes: [], tokenSubject: "u1" };
const tool = scenarioWriteTools[0];
const SAVED = "33333333-3333-4333-8333-333333333333";
const START = "44444444-4444-4444-8444-444444444444";
const retire62 = { type: "retirement_age" as const, person: "client" as const, age: 62 };

beforeEach(() => {
  h.saveSolverScenario.mockReset().mockResolvedValue({ ok: true, scenarioId: SAVED });
  h.loadEffectiveTree.mockReset().mockImplementation(async () => ({ effectiveTree: whatIfTree(), warnings: [] }));
  h.assertScenarioOfClient.mockReset().mockResolvedValue(undefined);
  h.firmClaudeWritesEnabled.mockReset().mockResolvedValue(true);
  h.verifyClientAccessFor.mockReset().mockResolvedValue({ ok: true, permission: "edit", firmId: "org_1", access: "own" });
  h.recordAudit.mockReset().mockResolvedValue(undefined);
});

describe("save_what_if_as_scenario", () => {
  it("saves the mutations the Solver screen would post, through the Solver's own save", async () => {
    const out = (await tool.run({ clientId: "c1", name: "Retire at 62", changes: [retire62] }, principal)) as Record<string, string>;
    expect(h.saveSolverScenario).toHaveBeenCalledWith({
      clientId: "c1",
      firmId: "org_1",
      source: "base",
      name: "Retire at 62",
      mutations: [{ kind: "retirement-age", person: "client", age: 62 }],
    });
    expect(out.scenarioId).toBe(SAVED);
    expect(out.scenarioUrl).toMatch(new RegExp(`/clients/c1/solver\\?scenario=${SAVED}$`));
  });

  it("starts from a saved scenario only after checking it is this household's", async () => {
    await tool.run({ clientId: "c1", scenarioId: START, name: "x", changes: [retire62] }, principal);
    expect(h.assertScenarioOfClient).toHaveBeenCalledWith("c1", START);
    expect(h.loadEffectiveTree).toHaveBeenCalledWith("c1", "org_1", START, {});
    expect(h.saveSolverScenario).toHaveBeenCalledWith(expect.objectContaining({ source: START }));
  });

  it("gives a new account the household's resolved growth default, as the Solver's quick-add does", async () => {
    const resolutionContext = {
      resolver: {
        resolveCategoryDefault: (c: string) =>
          ({ rate: ({ taxable: 0.0617, retirement: 0.0627, cash: 0.0217, real_estate: 0.0347 } as Record<string, number>)[c] }),
      },
    } as unknown as ResolutionContext;
    h.loadEffectiveTree.mockImplementation(async () => ({ effectiveTree: whatIfTree(), resolutionContext, warnings: [] }));
    await tool.run(
      {
        clientId: "c1",
        name: "New brokerage",
        changes: [{ type: "add_account", accountType: "taxable", owner: "client", balance: 10_000 }],
      },
      principal,
    );
    const [{ mutations }] = h.saveSolverScenario.mock.calls[0] as [{ mutations: SolverMutation[] }];
    expect(mutations[0]).toMatchObject({ kind: "account-upsert", value: { growthRate: 0.0617 } });
  });

  it("files the app's scenario.create audit as the advisor, beside the write audit", async () => {
    await tool.run({ clientId: "c1", name: "Retire at 62", changes: [retire62] }, principal);
    expect(h.recordAudit).toHaveBeenCalledWith({
      action: "scenario.create",
      resourceType: "scenario",
      resourceId: SAVED,
      clientId: "c1",
      firmId: "org_1",
      actorId: "u1",
      actorKind: "advisor",
      metadata: { source: "claude", mutationCount: 1 },
    });
    expect(h.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "mcp.tool_write",
        resourceId: "save_what_if_as_scenario",
        metadata: { tool: "save_what_if_as_scenario", via: "claude", scenarioId: SAVED, changeCount: 1 },
      }),
    );
  });

  it("refuses an id from another household before anything is saved or audited", async () => {
    await expect(
      tool.run(
        { clientId: "c1", name: "x", changes: [{ type: "expense_amount", expenseId: IDS.foreign, annualAmount: 1 }] },
        principal,
      ),
    ).rejects.toBeInstanceOf(WhatIfValidationError);
    expect(h.saveSolverScenario).not.toHaveBeenCalled();
    expect(h.recordAudit).not.toHaveBeenCalled();
  });

  it("refuses when the firm switch is off", async () => {
    h.firmClaudeWritesEnabled.mockResolvedValue(false);
    await expect(tool.run({ clientId: "c1", name: "x", changes: [retire62] }, principal)).rejects.toThrow(
      WRITE_DISABLED_MESSAGE,
    );
    expect(h.saveSolverScenario).not.toHaveBeenCalled();
  });

  it("says so plainly when the save can't be expressed, and audits nothing", async () => {
    h.saveSolverScenario.mockResolvedValue({ ok: false, rejectedNoteIds: ["n1"] });
    await expect(tool.run({ clientId: "c1", name: "x", changes: [retire62] }, principal)).rejects.toThrow(
      SAVE_FAILED_MESSAGE,
    );
    expect(h.recordAudit).not.toHaveBeenCalled();
  });

  it("refuses a blank name and an empty change list at the schema", () => {
    expect(tool.inputSchema.safeParse({ clientId: "c1", name: "   ", changes: [retire62] }).success).toBe(false);
    expect(tool.inputSchema.safeParse({ clientId: "c1", name: "x", changes: [] }).success).toBe(false);
  });
});
