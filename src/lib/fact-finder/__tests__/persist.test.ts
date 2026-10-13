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
import type { ChangeSet } from "../change-set";
import { emptyFactFinderState } from "../state";
import type { FactFinderState, FFChatTurn, FFRow, FFUnassignedHolding } from "../types";

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

const changeSet: ChangeSet = {
  builtAtVersion: 1,
  builtAt: "2026-10-13T12:00:00.000Z",
  lines: [
    {
      id: "r1/account",
      page: "accounts",
      sectionId: "cash",
      rowId: "r1",
      target: "account",
      action: "create",
      recordId: null,
      label: "Joint Checking",
      fixed: { category: "cash" },
      fields: [
        {
          key: "value",
          label: "Current value",
          next: 12000,
          shown: { next: "$12,000" },
          ticked: true,
          from: [{ sectionId: "cash", rowId: "r1", columnId: "currentValue" }],
        },
      ],
      warnings: [],
    },
  ],
  notices: [],
};

/** The stored slice's keys — what is in the database, not the reader's view of it. */
async function storedKeys(scope: FactFinderScope): Promise<string[]> {
  const [row] = await db.select({ p: clientImports.payloadJson }).from(clientImports).where(eq(clientImports.id, scope.importId));
  return Object.keys((row.p as { factFinder: Record<string, unknown> }).factFinder);
}

/** What the review writes: one cash row and its change set, at version 1. */
async function reviewed(): Promise<{ scope: FactFinderScope; state: FactFinderState }> {
  const scope = await newImport();
  const empty = emptyFactFinderState();
  await writeFactFinder(scope, 0, { ...empty, sections: { ...empty.sections, cash: [cashRow("r1")] }, changeSet }, { keepChangeSet: true });
  return { scope, state: (await loadFactFinder(scope))! };
}

const question: FFChatTurn = { id: "t1", role: "user", text: "What's left to check?", at: "2026-10-13T12:05:00.000Z" };

const holding: FFUnassignedHolding = {
  id: "h1",
  ticker: "VTI",
  name: "Vanguard Total Stock Market ETF",
  shares: 10,
  price: 250,
  marketValue: 2500,
  costBasis: null,
  by: "document",
  accountHint: "…1234",
};

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

  it("stores the change set when the review keeps it; a plain write that changes a row drops it", async () => {
    const { scope, state } = await reviewed();
    expect(state.changeSet).toEqual(changeSet);

    const patched = await writeFactFinder(scope, 1, { ...state, sections: { ...state.sections, cash: [cashRow("r1"), cashRow("r2")] } });
    expect(patched?.version).toBe(2);
    expect("changeSet" in patched!).toBe(false);
    expect(await storedKeys(scope)).not.toContain("changeSet");
  });

  it("keeps the change set through a plain write that changes only readings and the transcript", async () => {
    const { scope, state } = await reviewed();
    const failed = { status: "failed" as const, startedAt: "2026-10-13T12:01:00.000Z", reason: "Couldn't read" };
    const written = await writeFactFinder(scope, 1, { ...state, readings: { f1: failed }, transcript: [question] });
    expect(written?.changeSet).toEqual(changeSet);

    const loaded = await loadFactFinder(scope);
    expect(loaded?.version).toBe(2);
    expect(loaded?.changeSet).toEqual(changeSet);
    expect(loaded?.changeSet?.builtAtVersion).toBe(1);
  });

  it("keeps the change set when updateFactFinder rebuilds the rows with the same content (a reading, a chat turn that edits nothing)", async () => {
    const { scope } = await reviewed();
    const turn = await updateFactFinder(scope, (s) => ({
      ...s,
      sections: JSON.parse(JSON.stringify(s.sections)) as FactFinderState["sections"],
      transcript: [...s.transcript, question],
    }));
    expect(turn.version).toBe(2);
    expect(turn.changeSet).toEqual(changeSet);
    expect(await storedKeys(scope)).toContain("changeSet");
  });

  it("drops the change set when an updateFactFinder edit changes a cell", async () => {
    const { scope } = await reviewed();
    const edited = await updateFactFinder(scope, (s) => ({
      ...s,
      sections: { ...s.sections, cash: [{ ...s.sections.cash[0], cells: { accountName: { value: "Joint Checking", by: "advisor", pinned: true } } }] },
    }));
    expect(edited.version).toBe(2);
    expect("changeSet" in edited).toBe(false);
    expect(await storedKeys(scope)).not.toContain("changeSet");
  });

  it("drops the change set when an updateFactFinder write changes the unassigned holdings", async () => {
    const { scope } = await reviewed();
    const read = await updateFactFinder(scope, (s) => ({ ...s, unassignedHoldings: [holding] }));
    expect(read.version).toBe(2);
    expect("changeSet" in read).toBe(false);
    expect(await storedKeys(scope)).not.toContain("changeSet");
  });

  it("compares a stored fact finder with no unassigned holdings as an empty list", async () => {
    const scope = await newImport({ factFinder: { version: 1, sections: emptyFactFinderState().sections, changeSet } });
    const turn = await updateFactFinder(scope, (s) => ({ ...s, transcript: [question] }));
    expect(turn.version).toBe(2);
    expect(turn.changeSet).toEqual(changeSet);
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

  it("mergePayloadJson merges the mergeInto keys per sub-key, so a concurrent run's file results survive", async () => {
    const scope = await newImport({ fileResults: { fA: { a: 1 } }, payload: { x: 1 }, chat: { c: 3 } });
    await db
      .update(clientImports)
      .set({ payloadJson: mergePayloadJson({ fileResults: { fB: { b: 2 } } }, ["payload"], ["fileResults"]) })
      .where(eq(clientImports.id, scope.importId));
    const [row] = await db.select({ p: clientImports.payloadJson }).from(clientImports).where(eq(clientImports.id, scope.importId));
    expect(row.p).toEqual({ chat: { c: 3 }, fileResults: { fA: { a: 1 }, fB: { b: 2 } } });
  });
});
