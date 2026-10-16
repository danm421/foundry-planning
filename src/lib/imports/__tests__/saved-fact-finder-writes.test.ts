// src/lib/imports/__tests__/saved-fact-finder-writes.test.ts
//
// Live dev database: the write guard the legacy import writers share
// (`lib/imports/saved-fact-finder.ts`) — matching, which replaces the whole
// payload, and the commit orchestrator's two import writes. A fact finder saved
// to the plan is never written over; a statement-chat import closed with
// "Finish import" (committed, no fact finder) is written exactly as before
// Plan 4. Merging and matching are stubs; the writes are real. Everything lives
// under a firm id no other suite uses.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));
vi.mock("@/lib/imports/merge", () => ({
  mergeExtractionResults: vi.fn(() => ({
    accounts: [{ name: "Schwab Brokerage" }], incomes: [], expenses: [], liabilities: [], dependents: [], lifePolicies: [], wills: [], entities: [], warnings: [],
  })),
}));
vi.mock("@/lib/imports/match", () => ({
  runMatchingPass: vi.fn(async ({ payload }: { payload: object }) => ({ ...payload, accounts: [{ name: "Schwab Brokerage", match: { kind: "new" } }] })),
}));

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clientImports } from "@/db/schema";
import { emptyFactFinderState } from "@/lib/fact-finder/state";
import { dropSaveFirm, SAVE_ACTOR, seedSaveClient } from "@/lib/fact-finder/save/__tests__/harness";
import { markTabsCommitted, persistPartialCommit } from "../commit/orchestrator";
import { runImportMatching } from "../run-matching";
import { emptyImportPayload } from "../types";
import type { ExtractionResult } from "@/lib/extraction/types";

const FIRM = "firm_test_ff_save_legacy_writes";
const HAS_DB = !!process.env.DATABASE_URL;
const d = HAS_DB ? describe : describe.skip;
const CLOSED = { at: "2026-10-16T09:00:00.000Z", by: SAVE_ACTOR, saved: [], leftOut: [] };
const FILE_RESULTS = { f1: { documentType: "account_statement", warnings: [] } as unknown as ExtractionResult };
const PAYLOAD = { ...emptyImportPayload(), accounts: [{ name: "Schwab Brokerage", match: { kind: "new" } }] } as never;

type Kind = "a saved fact finder" | "a finished statement-chat import";

/** A committed import of either kind, holding the files a legacy run acts on. */
async function committedImport(kind: Kind) {
  const seed = await seedSaveClient(FIRM);
  const payloadJson =
    kind === "a saved fact finder"
      ? { factFinder: { ...emptyFactFinderState(), version: 2, closed: CLOSED }, fileResults: FILE_RESULTS }
      : { chat: { surface: "chat" }, fileResults: FILE_RESULTS };
  const [imp] = await db
    .insert(clientImports)
    .values({ clientId: seed.clientId, orgId: FIRM, mode: "onboarding", createdByUserId: SAVE_ACTOR, status: "committed", committedAt: new Date(CLOSED.at), payloadJson })
    .returning();
  return { imp, seed };
}

async function rowOf(importId: string) {
  const [row] = await db
    .select({ payloadJson: clientImports.payloadJson, perTabCommittedAt: clientImports.perTabCommittedAt, status: clientImports.status })
    .from(clientImports)
    .where(eq(clientImports.id, importId));
  return row;
}

d("the legacy import writers against a committed import (live DB)", () => {
  beforeAll(async () => dropSaveFirm(FIRM), 120_000);
  afterAll(async () => dropSaveFirm(FIRM), 120_000);

  it.each<[Kind, boolean]>([
    ["a saved fact finder", false],
    ["a finished statement-chat import", true],
  ])("matching %s — written: %s", async (kind, written) => {
    const { imp, seed } = await committedImport(kind);
    const before = await rowOf(imp.id);
    await runImportMatching({ importId: imp.id, clientId: seed.clientId, firmId: FIRM, mode: "onboarding", scenarioId: seed.scenarioId, fileResults: FILE_RESULTS });
    const after = await rowOf(imp.id);
    if (written) {
      // As before Plan 4: the whole payload replaced by the files and the matched payload.
      expect(Object.keys(after.payloadJson as object).sort()).toEqual(["fileResults", "payload"]);
    } else {
      expect(after).toEqual(before);
    }
  });

  it.each<[Kind, boolean]>([
    ["a saved fact finder", false],
    ["a finished statement-chat import", true],
  ])("committing a tab of %s — written: %s", async (kind, written) => {
    const { imp } = await committedImport(kind);
    const before = await rowOf(imp.id);
    await db.transaction((tx) => markTabsCommitted(tx, imp.id, ["accounts"], PAYLOAD));
    const after = await rowOf(imp.id);
    if (written) {
      expect(Object.keys(after.perTabCommittedAt as object)).toEqual(["accounts"]);
      expect(after.payloadJson).toMatchObject({ chat: { surface: "chat" }, payload: { accounts: [{ name: "Schwab Brokerage" }] } });
      expect(after.status).toBe("committed");
    } else {
      expect(after).toEqual(before);
    }
  });

  it.each<[Kind, boolean]>([
    ["a saved fact finder", false],
    ["a finished statement-chat import", true],
  ])("committing some rows of %s — written: %s", async (kind, written) => {
    const { imp } = await committedImport(kind);
    const before = await rowOf(imp.id);
    await db.transaction((tx) => persistPartialCommit(tx, imp.id, PAYLOAD));
    const after = await rowOf(imp.id);
    if (written) {
      expect(after.payloadJson).toMatchObject({ chat: { surface: "chat" }, payload: { accounts: [{ name: "Schwab Brokerage" }] } });
    } else {
      expect(after).toEqual(before);
    }
  });
});
