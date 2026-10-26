// src/lib/fact-finder/__tests__/finish.test.ts
//
// Live dev database: Finish — the import closed in one transaction with what
// its keep-open saves wrote to the plan as its saved list, and audited; refused
// while a document is reading. Everything lives under a firm id no other suite uses.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: "user_test_ff_save", orgId: "firm_test_ff_finish", orgRole: "org:admin" }),
}));

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, clientImports } from "@/db/schema";
import { SAVE_CLOSED_MESSAGE, SAVE_READING_MESSAGE } from "../api-types";
import { finishFactFinder } from "../finish";
import { loadFactFinder, type FactFinderScope } from "../persist";
import { dropSaveFirm, SAVE_ACTOR, seedSaveClient } from "../save/__tests__/harness";
import { emptyFactFinderState } from "../state";
import type { FactFinderState, FFApplied } from "../types";

const FIRM = "firm_test_ff_finish";
const HAS_DB = !!process.env.DATABASE_URL;
const d = HAS_DB ? describe : describe.skip;
const NOW = new Date("2026-10-15T12:00:00Z");

/** Two rounds of keep-open saves. */
const APPLIED: FFApplied[] = [
  { lineId: "f1/family_member", rowId: "f1", target: "family_member", recordId: "fm-emma", label: "Emma Hendricks", at: "2026-10-15T11:00:00.000Z" },
  { lineId: "tx1/account", rowId: "tx1", target: "account", recordId: "acct-ilit", label: "ILIT Brokerage", at: "2026-10-15T11:30:00.000Z" },
];

/** An open fact finder import, at version 3, on a new client. */
async function openImport(state: Partial<FactFinderState>): Promise<FactFinderScope> {
  const seed = await seedSaveClient(FIRM);
  const [imp] = await db
    .insert(clientImports)
    .values({ clientId: seed.clientId, orgId: FIRM, mode: "onboarding", createdByUserId: SAVE_ACTOR, payloadJson: { factFinder: { ...emptyFactFinderState(), version: 3, ...state } } })
    .returning({ id: clientImports.id });
  return { importId: imp.id, clientId: seed.clientId, firmId: FIRM };
}

async function importOf(scope: FactFinderScope) {
  const [row] = await db.select({ status: clientImports.status, committedAt: clientImports.committedAt }).from(clientImports).where(eq(clientImports.id, scope.importId));
  const audit = await db.select().from(auditLog).where(and(eq(auditLog.resourceId, scope.importId), eq(auditLog.action, "import.fact_finder_finished")));
  return { ...row, audit, factFinder: await loadFactFinder(scope) };
}

d("finishFactFinder (live DB)", () => {
  beforeAll(async () => dropSaveFirm(FIRM));
  afterAll(async () => dropSaveFirm(FIRM));

  it("finish closes the import with the applied list as saved", async () => {
    const scope = await openImport({ applied: APPLIED });
    const outcome = await finishFactFinder(scope, SAVE_ACTOR, NOW);

    const imp = await importOf(scope);
    expect(outcome).toEqual({ ok: true, factFinder: imp.factFinder });
    expect(imp).toMatchObject({ status: "committed", committedAt: NOW });
    expect(imp.factFinder?.version).toBe(4);
    expect(imp.factFinder?.closed).toEqual({
      at: NOW.toISOString(),
      by: SAVE_ACTOR,
      saved: [
        { lineId: "f1/family_member", rowId: "f1", target: "family_member", recordId: "fm-emma", label: "Emma Hendricks" },
        { lineId: "tx1/account", rowId: "tx1", target: "account", recordId: "acct-ilit", label: "ILIT Brokerage" },
      ],
      leftOut: [],
    });
    expect(imp.audit).toHaveLength(1);
    expect(imp.audit[0]).toMatchObject({ firmId: FIRM, clientId: scope.clientId, actorId: SAVE_ACTOR, resourceType: "client_import", metadata: { saved: 2 } });

    // Finished once: a second finish writes nothing.
    expect(await finishFactFinder(scope, SAVE_ACTOR, NOW)).toEqual({ ok: false, status: 409, error: SAVE_CLOSED_MESSAGE });
    expect(await importOf(scope)).toEqual(imp);
  });

  it("finish refuses while a document is reading", async () => {
    // Started two minutes before the finish: still being read.
    const scope = await openImport({ applied: APPLIED, readings: { f1: { status: "reading", startedAt: "2026-10-15T11:58:00.000Z" } } });
    expect(await finishFactFinder(scope, SAVE_ACTOR, NOW)).toEqual({ ok: false, status: 409, error: SAVE_READING_MESSAGE });

    const imp = await importOf(scope);
    expect(imp).toMatchObject({ status: "draft", committedAt: null, audit: [] });
    expect(imp.factFinder?.closed).toBeUndefined();
    expect(imp.factFinder?.version).toBe(3);
  });
});
