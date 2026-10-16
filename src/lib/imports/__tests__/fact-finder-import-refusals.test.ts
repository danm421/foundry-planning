// src/lib/imports/__tests__/fact-finder-import-refusals.test.ts
//
// Live dev database: the old Review Wizard routes refuse a fact finder import
// that is still OPEN (Plan 5, D7). The real PATCH, match and commit handlers
// run against a stored fact finder import that also holds what each of them
// would act on; every one answers 409, and the stored payload (and status) is
// byte-identical afterwards. Only the Clerk session, the rate limit and the
// subscription gate are stubs. Everything lives under a firm id no other suite
// uses.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const FIRM = "firm_test_ff_p5_refusals";

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({
    userId: "user_test_ff_save",
    orgId: "firm_test_ff_p5_refusals",
    orgRole: "org:admin",
    sessionClaims: { org_public_metadata: { entitlements: ["ai_import"] } },
  }),
}));
vi.mock("@/lib/authz", async () => {
  const actual = await vi.importActual<typeof import("@/lib/authz")>("@/lib/authz");
  return { ...actual, requireActiveSubscription: vi.fn(async () => undefined) };
});
vi.mock("@/lib/rate-limit", () => ({ checkImportRateLimit: vi.fn(async () => ({ allowed: true })) }));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));

import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { clientImports } from "@/db/schema";
import { emptyFactFinderState } from "@/lib/fact-finder/state";
import { dropSaveFirm, SAVE_ACTOR, seedSaveClient } from "@/lib/fact-finder/save/__tests__/harness";
import { FACT_FINDER_ONLY_MESSAGE } from "../saved-fact-finder";
import { POST as commit } from "@/app/api/clients/[id]/imports/[importId]/commit/route";
import { POST as match } from "@/app/api/clients/[id]/imports/[importId]/match/route";
import { PATCH } from "@/app/api/clients/[id]/imports/[importId]/route";

const HAS_DB = !!process.env.DATABASE_URL;
const d = HAS_DB ? describe : describe.skip;

/** An open fact finder import that also holds the files and payload a wizard run would act on. */
async function openFactFinderImport() {
  const seed = await seedSaveClient(FIRM);
  const [imp] = await db
    .insert(clientImports)
    .values({
      clientId: seed.clientId,
      orgId: FIRM,
      mode: "onboarding",
      createdByUserId: SAVE_ACTOR,
      status: "review",
      payloadJson: {
        factFinder: { ...emptyFactFinderState(), version: 4, notes: "Prefers to retire at 62." },
        fileResults: { f1: { documentType: "account_statement", warnings: [] } },
        payload: { accounts: [{ name: "Schwab Brokerage" }] },
      },
    })
    .returning({ id: clientImports.id });
  return { seed, importId: imp.id };
}

/** The stored row as the database prints it — byte for byte. */
async function storedRow(importId: string) {
  const [row] = await db
    .select({ payloadText: sql<string>`${clientImports.payloadJson}::text`, status: clientImports.status, updatedAt: clientImports.updatedAt })
    .from(clientImports)
    .where(eq(clientImports.id, importId));
  return row;
}

const call = (clientId: string, importId: string, path: string, method: string, body: unknown) =>
  [
    new Request(`https://app.foundryplanning.com/api/clients/${clientId}/imports/${importId}${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }) as never,
    { params: Promise.resolve({ id: clientId, importId }) },
  ] as const;

d("the old wizard routes against an open fact finder import (live DB)", () => {
  beforeAll(async () => dropSaveFirm(FIRM), 120_000);
  afterAll(async () => dropSaveFirm(FIRM), 120_000);

  it("PATCH, match and commit each answer 409 and leave the stored import byte-identical", async () => {
    const { seed, importId } = await openFactFinderImport();
    const before = await storedRow(importId);
    expect(before.payloadText).toContain("Prefers to retire at 62.");

    const patched = await PATCH(...call(seed.clientId, importId, "", "PATCH", { payloadJson: { payload: { accounts: [] } }, status: "extracting" }));
    expect(patched.status).toBe(409);
    expect(await patched.json()).toEqual({ error: FACT_FINDER_ONLY_MESSAGE });
    expect(await storedRow(importId)).toEqual(before);

    const matched = await match(...call(seed.clientId, importId, "/match", "POST", {}));
    expect(matched.status).toBe(409);
    expect(await matched.json()).toEqual({ error: FACT_FINDER_ONLY_MESSAGE });
    expect(await storedRow(importId)).toEqual(before);

    const committed = await commit(...call(seed.clientId, importId, "/commit", "POST", { tabs: ["goals"] }));
    expect(committed.status).toBe(409);
    expect(await committed.json()).toEqual({ error: FACT_FINDER_ONLY_MESSAGE });
    expect(await storedRow(importId)).toEqual(before);
  });
});
