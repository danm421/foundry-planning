// src/app/api/clients/[id]/imports/[importId]/files/[fileId]/extract/__tests__/closed-import.test.ts
//
// Live dev database: re-reading one file through the old wizard route never
// writes over a fact finder saved to the plan (Plan 4, Review Focus 5). Its
// write replaces the import's whole payload, so a save that lands while the
// file is being read — or one that landed before — would lose its closed
// record and change list. The reader and the gates around the route are stubs;
// the import, its file and the save are real. Everything lives under a firm id
// no other suite uses.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const FIRM = "firm_test_ff_save_file_extract";

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({
    userId: "user_test_ff_save",
    orgId: "firm_test_ff_save_file_extract",
    orgRole: "org:admin",
    sessionClaims: { org_public_metadata: { entitlements: ["ai_import"] } },
  }),
}));
vi.mock("@/lib/authz", async () => {
  const actual = await vi.importActual<typeof import("@/lib/authz")>("@/lib/authz");
  return { ...actual, requireActiveSubscription: vi.fn(async () => undefined) };
});
vi.mock("@/lib/clients/authz", () => ({
  verifyClientAccess: vi.fn(async () => ({ ok: true, permission: "edit", firmId: "firm_test_ff_save_file_extract", access: "own" })),
}));
vi.mock("@/lib/rate-limit", () => ({ checkImportRateLimit: vi.fn(async () => ({ allowed: true })) }));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));
vi.mock("@/lib/extraction/extract", () => ({ extractDocument: vi.fn() }));
vi.mock("@/lib/imports/blob", () => ({ downloadImportFile: vi.fn(async () => Buffer.from("%PDF-1.4 statement")) }));

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clientImportExtractions, clientImportFiles, clientImports } from "@/db/schema";
import { extractDocument } from "@/lib/extraction/extract";
import type { ExtractionResult } from "@/lib/extraction/types";
import { SAVE_CLOSED_MESSAGE } from "@/lib/fact-finder/api-types";
import { closeFactFinder, loadFactFinder } from "@/lib/fact-finder/persist";
import { emptyFactFinderState } from "@/lib/fact-finder/state";
import { dropSaveFirm, SAVE_ACTOR, seedSaveClient } from "@/lib/fact-finder/save/__tests__/harness";
import { POST } from "../route";

const HAS_DB = !!process.env.DATABASE_URL;
const d = HAS_DB ? describe : describe.skip;
const CLOSED = { at: "2026-10-16T09:00:00.000Z", by: SAVE_ACTOR, saved: [], leftOut: [] };
const READ = {
  documentType: "account_statement",
  extracted: { accounts: [{ name: "Schwab Brokerage" }], incomes: [], expenses: [], liabilities: [], entities: [], lifePolicies: [], wills: [] },
  warnings: [],
  promptVersion: "test",
} as unknown as ExtractionResult;

/** A fact finder import with one statement uploaded. */
async function importWithAStatement() {
  const seed = await seedSaveClient(FIRM);
  const [imp] = await db
    .insert(clientImports)
    .values({ clientId: seed.clientId, orgId: FIRM, mode: "onboarding", createdByUserId: SAVE_ACTOR, payloadJson: { factFinder: { ...emptyFactFinderState(), version: 1 } } })
    .returning({ id: clientImports.id });
  const [file] = await db
    .insert(clientImportFiles)
    .values({
      importId: imp.id, blobUrl: "https://x.private.blob/stmt.pdf", blobPathname: "imports/stmt.pdf", originalFilename: "stmt.pdf",
      contentHash: "hash", sizeBytes: 18, detectedKind: "pdf", documentType: "account_statement",
    })
    .returning({ id: clientImportFiles.id });
  const scope = { importId: imp.id, clientId: seed.clientId, firmId: FIRM };
  const reRead = () =>
    POST(
      new Request(`https://app.foundryplanning.com/api/clients/${scope.clientId}/imports/${imp.id}/files/${file.id}/extract`, {
        method: "POST", headers: { "content-type": "application/json" }, body: "{}",
      }) as never,
      { params: Promise.resolve({ id: scope.clientId, importId: imp.id, fileId: file.id }) },
    );
  return { scope, fileId: file.id, reRead };
}

async function importOf(importId: string) {
  const [row] = await db.select({ status: clientImports.status, payloadJson: clientImports.payloadJson }).from(clientImports).where(eq(clientImports.id, importId));
  return row;
}

d("re-reading one file of a fact finder import (live DB)", () => {
  beforeAll(async () => dropSaveFirm(FIRM), 120_000);
  afterAll(async () => dropSaveFirm(FIRM), 120_000);

  it("a save that lands while the file is read: the import stays committed, with its closed record — the read's payload isn't written", async () => {
    const { scope, reRead } = await importWithAStatement();
    vi.mocked(extractDocument).mockImplementationOnce(async () => {
      await db.transaction((tx) => closeFactFinder(tx, scope, 1, CLOSED));
      return READ;
    });

    await reRead();
    const after = await importOf(scope.importId);
    expect(after.status).toBe("committed");
    expect(after.payloadJson).not.toHaveProperty("fileResults");
    expect((await loadFactFinder(scope))?.closed).toEqual(CLOSED);
  });

  it("an import already saved is refused before the file is read, and stays as it was", async () => {
    const { scope, fileId, reRead } = await importWithAStatement();
    await db.transaction((tx) => closeFactFinder(tx, scope, 1, CLOSED));
    const before = await importOf(scope.importId);
    vi.mocked(extractDocument).mockClear();

    const res = await reRead();
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: SAVE_CLOSED_MESSAGE });
    expect(extractDocument).not.toHaveBeenCalled();
    expect(await db.select().from(clientImportExtractions).where(eq(clientImportExtractions.fileId, fileId))).toEqual([]);
    expect(await importOf(scope.importId)).toEqual(before);
  });

  it("an import that isn't saved still takes the file's read", async () => {
    const { scope, fileId, reRead } = await importWithAStatement();
    vi.mocked(extractDocument).mockResolvedValueOnce(READ);

    expect((await reRead()).status).toBe(200);
    const after = await importOf(scope.importId);
    expect(after.status).not.toBe("committed");
    expect(Object.keys((after.payloadJson as { fileResults: object }).fileResults)).toEqual([fileId]);
  });
});
