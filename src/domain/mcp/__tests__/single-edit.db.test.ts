// src/domain/mcp/__tests__/single-edit.db.test.ts
//
// Live dev database: a single edit and an assumptions change as the Claude
// connector makes them — a principal, no Clerk session. An edit saves through a
// one-row fact finder import that ends closed; an edit that can't save writes
// nothing and leaves no draft behind (Review Focus #5). Everything lives under
// a firm id no other suite uses.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// No session at all: every access check must run on the principal.
vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: null, orgId: null, orgRole: null, actor: null }),
}));
// The firm's switch is on, and the rate limits allow the call — neither is what these tests are about.
vi.mock("@/lib/firm-settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/firm-settings")>()),
  firmClaudeWritesEnabled: async () => true,
}));
vi.mock("@/lib/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limit")>()),
  checkMcpRateLimit: async () => ({ allowed: true, remaining: 1, reset: 0 }),
  checkImportRateLimit: async () => ({ allowed: true, remaining: 1, reset: 0 }),
}));

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, auditLog, clientImports, planSettings } from "@/db/schema";
import { createAccountForClient } from "@/lib/clients/accounts-writes";
import { dropSaveFirm, SAVE_ACTOR, seedSaveClient } from "@/lib/fact-finder/save/__tests__/harness";
import { unwrap } from "@/lib/fact-finder/save/types";
import { readFactFinderState } from "@/lib/fact-finder/state";
import type { McpPrincipal } from "@/lib/mcp/principal";
import { McpInputError } from "../define-tool";
import { householdBuildingTools } from "../tools/household-building";

const FIRM = "firm_test_mcp_single_edit";
const HAS_DB = !!process.env.DATABASE_URL;
const d = HAS_DB ? describe : describe.skip;

const PRINCIPAL: McpPrincipal = {
  userId: SAVE_ACTOR,
  orgId: FIRM,
  orgRole: "org:admin",
  scopes: [],
  tokenSubject: SAVE_ACTOR,
  canWrite: true,
  entitlements: ["ai_import"],
};
const tool = (name: string) => householdBuildingTools.find((t) => t.name === name)!;

/** A client with one IRA at $300,000, made on the principal too: there is no session. */
async function clientWithIra() {
  const seed = await seedSaveClient(FIRM);
  const ira = unwrap(
    await createAccountForClient({
      clientId: seed.clientId, firmId: FIRM, actorId: SAVE_ACTOR, principal: PRINCIPAL,
      input: { name: "Rollover IRA", category: "retirement", subType: "traditional_ira", value: 300000 },
    }),
  ).resourceId;
  return { seed, ira };
}

const valueOf = async (accountId: string) =>
  Number((await db.select({ value: accounts.value }).from(accounts).where(eq(accounts.id, accountId)))[0].value);

const importsOf = (clientId: string) =>
  db
    .select({ id: clientImports.id, status: clientImports.status, discardedAt: clientImports.discardedAt, notes: clientImports.notes, payloadJson: clientImports.payloadJson })
    .from(clientImports)
    .where(eq(clientImports.clientId, clientId));

const toolWrites = (clientId: string) =>
  db
    .select({ actorId: auditLog.actorId, metadata: auditLog.metadata })
    .from(auditLog)
    .where(and(eq(auditLog.clientId, clientId), eq(auditLog.action, "mcp.tool_write")));

d("single edits from Claude, on a principal with no session (live DB)", () => {
  // Clearing a firm of its households can outlast the default hook timeout on a cold dev branch.
  beforeAll(async () => dropSaveFirm(FIRM), 120_000);
  afterAll(async () => dropSaveFirm(FIRM), 120_000);

  it("changes one account's balance in one call and leaves a closed import", async () => {
    const { seed, ira } = await clientWithIra();

    const out = (await tool("update_plan_detail").run(
      { clientId: seed.clientId, sectionId: "retirement", recordId: ira, cells: { currentValue: 412000 } },
      PRINCIPAL,
    )) as { importId: string; saved: unknown[] };

    expect(await valueOf(ira)).toBe(412000);
    expect(out.saved).toMatchObject([{ action: "update", what: "Account", fields: [{ key: "value", included: true }] }]);

    const imports = await importsOf(seed.clientId);
    expect(imports).toHaveLength(1);
    expect(imports[0]).toMatchObject({ id: out.importId, status: "committed", notes: "Claude edit: Retirement Accounts" });
    expect(readFactFinderState(imports[0].payloadJson).closed).toMatchObject({ by: SAVE_ACTOR, leftOut: [] });

    expect(await toolWrites(seed.clientId)).toEqual([
      {
        actorId: SAVE_ACTOR,
        metadata: { importId: out.importId, sectionId: "retirement", saved: 1, tool: "update_plan_detail", via: "claude" },
      },
    ]);
  });

  it("leaves no open draft when the edit changes nothing", async () => {
    const { seed, ira } = await clientWithIra();

    const err = await tool("update_plan_detail")
      .run({ clientId: seed.clientId, sectionId: "retirement", recordId: ira, cells: { currentValue: 300000 } }, PRINCIPAL)
      .catch((e: unknown) => e);

    expect(err).toEqual(new McpInputError("Nothing to change — the plan already has these values."));
    expect(await valueOf(ira)).toBe(300000);
    const imports = await importsOf(seed.clientId);
    expect(imports).toHaveLength(1);
    expect(imports[0].status).toBe("discarded");
    expect(imports[0].discardedAt).not.toBeNull();
    expect(await toolWrites(seed.clientId)).toEqual([]);
  });

  it("changes inflation and a default growth rate as custom rates, from the values the plan used", async () => {
    const seed = await seedSaveClient(FIRM);
    const settingsOf = async () =>
      (await db.select().from(planSettings).where(eq(planSettings.scenarioId, seed.scenarioId)))[0];
    const was = await settingsOf();

    const out = (await tool("update_plan_assumptions").run(
      { clientId: seed.clientId, changes: { inflationRate: 0.031, defaultGrowthTaxable: 0.064 } },
      PRINCIPAL,
    )) as { changed: { key: string; from: unknown; to: unknown }[] };

    expect(await settingsOf()).toMatchObject({
      inflationRate: "0.0310",
      inflationRateSource: "custom",
      defaultGrowthTaxable: "0.0640",
      growthSourceTaxable: "custom",
    });
    expect(out.changed.map((c) => c.key)).toEqual(["inflationRate", "defaultGrowthTaxable", "inflationRateSource", "growthSourceTaxable"]);
    expect(out.changed).toContainEqual({ key: "defaultGrowthTaxable", from: Number(was.defaultGrowthTaxable), to: 0.064 });
    expect(out.changed).toContainEqual({ key: "growthSourceTaxable", from: was.growthSourceTaxable, to: "custom" });
    expect(out.changed.find((c) => c.key === "inflationRate")).toMatchObject({ from: expect.any(Number), to: 0.031 });
    expect(await toolWrites(seed.clientId)).toEqual([
      {
        actorId: SAVE_ACTOR,
        metadata: { keys: ["inflationRate", "defaultGrowthTaxable"], tool: "update_plan_assumptions", via: "claude" },
      },
    ]);
  });
});
