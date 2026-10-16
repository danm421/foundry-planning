// src/lib/imports/__tests__/run-extraction-closed.test.ts
//
// Live dev database: the statement reader's last write — the import's status —
// never moves a saved fact finder import back (Plan 4, D10). A read that was
// already running when the save closed the import ends after it; so does a
// POST to the old extract route. Any other import — a statement-chat import
// closed with "Finish import" included — is written as before Plan 4. The
// reader itself is a stub. Everything lives under a firm id no other suite uses.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: "user_test_ff_save", orgId: "firm_test_ff_save_run_extraction", orgRole: "org:admin" }),
}));
vi.mock("@/lib/extraction/extract", () => ({ extractDocument: vi.fn() }));
vi.mock("@/lib/imports/blob", () => ({ downloadImportFile: vi.fn(async () => Buffer.from("%PDF-1.4 statement")) }));

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clientImportFiles, clientImports } from "@/db/schema";
import { extractDocument } from "@/lib/extraction/extract";
import type { ExtractionResult } from "@/lib/extraction/types";
import { closeFactFinder, loadFactFinder } from "@/lib/fact-finder/persist";
import { emptyFactFinderState } from "@/lib/fact-finder/state";
import { dropSaveFirm, SAVE_ACTOR, seedSaveClient } from "@/lib/fact-finder/save/__tests__/harness";
import { runImportExtraction } from "../run-extraction";

const FIRM = "firm_test_ff_save_run_extraction";
const HAS_DB = !!process.env.DATABASE_URL;
const d = HAS_DB ? describe : describe.skip;
const CLOSED = { at: "2026-10-15T12:00:00.000Z", by: SAVE_ACTOR, saved: [], leftOut: [] };

/** A statement the reader found one account in: enough for the run to call the import ready for review. */
const READ = {
  documentType: "account_statement",
  extracted: { accounts: [{ name: "Schwab Brokerage" }], incomes: [], expenses: [], liabilities: [], entities: [], lifePolicies: [], wills: [] },
  warnings: [],
  promptVersion: "test",
} as unknown as ExtractionResult;

/** A fact finder import with one statement uploaded, as the screen leaves it before "Read documents" — or, with `finishedChat`, a statement-chat import closed with "Finish import". */
async function importWithAStatement(opts: { finishedChat?: boolean } = {}) {
  const seed = await seedSaveClient(FIRM);
  const [imp] = await db
    .insert(clientImports)
    .values({
      clientId: seed.clientId, orgId: FIRM, mode: "onboarding", createdByUserId: SAVE_ACTOR,
      ...(opts.finishedChat
        ? { status: "committed" as const, committedAt: new Date(CLOSED.at), payloadJson: { chat: { surface: "chat" } } }
        : { payloadJson: { factFinder: { ...emptyFactFinderState(), version: 1 } } }),
    })
    .returning({ id: clientImports.id });
  const [file] = await db
    .insert(clientImportFiles)
    .values({
      importId: imp.id, blobUrl: "https://x.private.blob/stmt.pdf", blobPathname: "imports/stmt.pdf", originalFilename: "stmt.pdf",
      contentHash: "hash", sizeBytes: 18, detectedKind: "pdf", documentType: "account_statement",
    })
    .returning({ id: clientImportFiles.id });
  const scope = { importId: imp.id, clientId: seed.clientId, firmId: FIRM };
  const read = () => runImportExtraction({ ...scope, model: "mini", extractHoldings: false, fileIds: [file.id] });
  return { scope, read };
}

async function statusOf(importId: string) {
  const [row] = await db.select({ status: clientImports.status, committedAt: clientImports.committedAt }).from(clientImports).where(eq(clientImports.id, importId));
  return row;
}

d("runImportExtraction against a saved fact finder import (live DB)", () => {
  beforeAll(async () => {
    vi.mocked(extractDocument).mockResolvedValue(READ);
    await dropSaveFirm(FIRM);
  }, 120_000);
  afterAll(async () => dropSaveFirm(FIRM), 120_000);

  it("a read that ends after the save closed the import leaves it committed, saved and closed", async () => {
    const { scope, read } = await importWithAStatement();
    const closed = await db.transaction((tx) => closeFactFinder(tx, scope, 1, CLOSED));
    expect(closed?.closed).toEqual(CLOSED);

    expect((await read()).succeeded).toBe(1);
    expect(await statusOf(scope.importId)).toEqual({ status: "committed", committedAt: new Date(CLOSED.at) });
    expect((await loadFactFinder(scope))?.closed).toEqual(CLOSED);
  });

  it("a finished statement-chat import (committed, no fact finder) is written as before Plan 4 — its status from the read", async () => {
    const { scope, read } = await importWithAStatement({ finishedChat: true });
    expect((await read()).status).toBe("review");
    expect(await statusOf(scope.importId)).toEqual({ status: "review", committedAt: new Date(CLOSED.at) });
    const [row] = await db.select({ payloadJson: clientImports.payloadJson }).from(clientImports).where(eq(clientImports.id, scope.importId));
    expect(row.payloadJson).toMatchObject({ chat: { surface: "chat" }, fileResults: expect.any(Object) });
  });

  it("a read of an import that isn't saved still sets its status", async () => {
    const { scope, read } = await importWithAStatement();
    expect((await read()).status).toBe("review");
    expect(await statusOf(scope.importId)).toEqual({ status: "review", committedAt: null });
  });
});
