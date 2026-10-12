// src/lib/fact-finder/__tests__/persist.test.ts
//
// Live dev database (it is the compare-and-set itself that is under test; a
// mocked update can't show a version race). Every row lives under a firm id no
// other suite uses, and afterAll removes it.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { clientImports, clients, crmHouseholds } from "@/db/schema";
import { createTestClientWithScenario } from "@/test/factories";
import { mergePayloadJson } from "@/lib/imports/payload-json-sql";
import {
  FactFinderNotFoundError,
  loadFactFinder,
  updateFactFinder,
  writeFactFinder,
  type FactFinderScope,
} from "../persist";
import { emptyFactFinderState } from "../state";
import type { FFRow } from "../types";

const FIRM = "firm_test_fact_finder_persist";
const HAS_DB = !!process.env.DATABASE_URL;
let clientId: string;

async function newImport(payloadJson: Record<string, unknown> = {}): Promise<FactFinderScope> {
  const [imp] = await db
    .insert(clientImports)
    .values({ clientId, orgId: FIRM, mode: "onboarding", createdByUserId: "user_test", payloadJson })
    .returning({ id: clientImports.id });
  return { importId: imp.id, clientId, firmId: FIRM };
}

async function dropFirm() {
  const rows = await db.select({ id: clients.id, householdId: clients.crmHouseholdId }).from(clients).where(eq(clients.firmId, FIRM));
  if (rows.length === 0) return;
  await db.delete(clients).where(inArray(clients.id, rows.map((r) => r.id)));
  await db.delete(crmHouseholds).where(inArray(crmHouseholds.id, rows.map((r) => r.householdId)));
}

const cashRow = (id: string): FFRow => ({
  id,
  cells: { accountName: { value: id, by: "advisor", pinned: true } },
  sourceFileIds: [],
});

describe.skipIf(!HAS_DB)("fact finder persistence (live DB)", () => {
  beforeAll(async () => {
    await dropFirm();
    ({ clientId } = await createTestClientWithScenario(FIRM));
  });
  afterAll(dropFirm);

  it("reads an import with no slice as an empty fact finder at version 0", async () => {
    const scope = await newImport({ chat: { surface: "chat" } });
    expect(await loadFactFinder(scope)).toEqual(emptyFactFinderState());
  });

  it("writes only on the expected version", async () => {
    const scope = await newImport();
    const first = await writeFactFinder(scope, 0, emptyFactFinderState());
    expect(first?.version).toBe(1);
    expect(await writeFactFinder(scope, 0, emptyFactFinderState())).toBeNull();
    expect((await loadFactFinder(scope))?.version).toBe(1);
  });

  it("keeps every other payload slice when it writes", async () => {
    const scope = await newImport({ chat: { surface: "chat" }, fileResults: { f1: { x: 1 } } });
    await writeFactFinder(scope, 0, emptyFactFinderState());
    const [row] = await db.select({ p: clientImports.payloadJson }).from(clientImports).where(eq(clientImports.id, scope.importId));
    const payload = row.p as Record<string, unknown>;
    expect(payload.chat).toEqual({ surface: "chat" });
    expect(payload.fileResults).toEqual({ f1: { x: 1 } });
    expect((payload.factFinder as { version: number }).version).toBe(1);
  });

  it("lets a typed edit and a reading land together without losing either", async () => {
    const scope = await newImport();
    const add = (id: string) => (s: ReturnType<typeof emptyFactFinderState>) => ({
      ...s,
      sections: { ...s.sections, cash: [...s.sections.cash, cashRow(id)] },
    });
    await Promise.all([updateFactFinder(scope, add("typed")), updateFactFinder(scope, add("reading"))]);
    const final = await loadFactFinder(scope);
    expect(final?.sections.cash.map((r) => r.id).sort()).toEqual(["reading", "typed"]);
    expect(final?.version).toBe(2);
  });

  it("skips the write when nothing changed", async () => {
    const scope = await newImport();
    const same = await updateFactFinder(scope, (s) => s);
    expect(same.version).toBe(0);
    expect((await loadFactFinder(scope))?.version).toBe(0);
  });

  it("can't see another firm's import or a discarded one", async () => {
    const scope = await newImport();
    expect(await loadFactFinder({ ...scope, firmId: "firm_someone_else" })).toBeNull();
    await expect(updateFactFinder({ ...scope, firmId: "firm_someone_else" }, (s) => s)).rejects.toBeInstanceOf(FactFinderNotFoundError);
    await db.update(clientImports).set({ discardedAt: new Date() }).where(eq(clientImports.id, scope.importId));
    expect(await loadFactFinder(scope)).toBeNull();
  });

  it("mergePayloadJson drops the listed keys and replaces only the patched ones", async () => {
    const scope = await newImport({ payload: { a: 1 }, assemble: { b: 2 }, chat: { c: 3 }, factFinder: { version: 4 } });
    await db
      .update(clientImports)
      .set({ payloadJson: mergePayloadJson({ fileResults: { f9: {} } }, ["payload", "assemble"]) })
      .where(eq(clientImports.id, scope.importId));
    const [row] = await db.select({ p: clientImports.payloadJson }).from(clientImports).where(eq(clientImports.id, scope.importId));
    expect(row.p).toEqual({ chat: { c: 3 }, factFinder: { version: 4 }, fileResults: { f9: {} } });
  });
});
