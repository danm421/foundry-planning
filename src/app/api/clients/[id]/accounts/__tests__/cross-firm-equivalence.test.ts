// Cross-firm equivalence tests for POST /api/clients/[id]/accounts.
//
// These tests prove the pilot batch transform: a shared-EDIT recipient
// (other firm) creates a row → (a) row scoped to OWNING firm/client,
// (b) audit row firmId = OWNING, (c) metadata.crossFirmActor === true.
// A shared-VIEW recipient still 403s. An own-firm write is unchanged (no
// crossFirmActor key).
//
// Pattern: auth mocked, real DB, clientShares rows inserted per-test.
// Follows src/lib/clients/__tests__/authz.test.ts (DB-backed mock pattern).
import { describe, it, expect, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, auditLog, clientShares } from "@/db/schema";

// Mock Clerk auth — the test overrides this per-case via vi.mocked().
vi.mock("@clerk/nextjs/server", async () => {
  const actual = await vi.importActual<typeof import("@clerk/nextjs/server")>(
    "@clerk/nextjs/server",
  );
  return {
    ...actual,
    auth: vi.fn(),
    // clerkClient is called by requireActiveSubscriptionForFirm for cross-firm orgs.
    clerkClient: vi.fn().mockResolvedValue({
      organizations: {
        getOrganization: vi.fn().mockResolvedValue({
          publicMetadata: { is_founder: true },
        }),
      },
    }),
  };
});

import { auth } from "@clerk/nextjs/server";
import { POST } from "../route";

const HAS_DB = !!process.env.DATABASE_URL;
const d = HAS_DB ? describe : describe.skip;

// Owning org — matches COOPER_FIRM_ID used in other test fixtures.
const OWNING_FIRM = "org_3CitTEIe8PJa1BVYw7LnEjkiP9r";
const OWNING_ADV = "adv_cross_firm_acct";
const RECIPIENT_USER = "user_cross_firm_rcpt";
const CALLER_ORG = "org_other_firm_accts";

// Snapshot of the Cooper client we'll share — must exist in dev DB.
const COOPER_CLIENT_ID = "877a9532-f8ea-49b0-9db7-aadd64fab82a";

const TEST_BODY = { name: "Cross-firm test account", category: "taxable" } as const;

/** Set auth() to return an own-firm caller for OWNING_FIRM. */
function setOwnFirmAuth(userId = "user_own_firm_test") {
  vi.mocked(auth).mockResolvedValue({
    userId,
    orgId: OWNING_FIRM,
    orgRole: "org:admin",
    sessionClaims: { org_public_metadata: { is_founder: true } },
  } as never);
}

/** Set auth() to return a cross-firm caller (CALLER_ORG, not OWNING_FIRM). */
function setCrossFirmAuth(userId = RECIPIENT_USER) {
  vi.mocked(auth).mockResolvedValue({
    userId,
    orgId: CALLER_ORG,
    orgRole: "org:admin",
    sessionClaims: { org_public_metadata: { is_founder: true } },
  } as never);
}

d("POST /accounts — cross-firm equivalence (pilot batch)", () => {
  const createdAccountIds: string[] = [];

  afterEach(async () => {
    // Clean up any accounts + clientShares created by these tests.
    for (const id of createdAccountIds.splice(0)) {
      await db.delete(accounts).where(eq(accounts.id, id));
    }
    await db
      .delete(clientShares)
      .where(eq(clientShares.recipientUserId, RECIPIENT_USER));
  });

  async function insertEditShare() {
    await db.insert(clientShares).values({
      firmId: OWNING_FIRM,
      ownerUserId: OWNING_ADV,
      recipientUserId: RECIPIENT_USER,
      recipientEmail: "rcpt@otherfirm.example",
      scope: "client",
      clientId: COOPER_CLIENT_ID,
      permission: "edit",
      createdBy: OWNING_ADV,
    });
  }

  async function insertViewShare() {
    await db.insert(clientShares).values({
      firmId: OWNING_FIRM,
      ownerUserId: OWNING_ADV,
      recipientUserId: RECIPIENT_USER,
      recipientEmail: "rcpt@otherfirm.example",
      scope: "client",
      clientId: COOPER_CLIENT_ID,
      permission: "view",
      createdBy: OWNING_ADV,
    });
  }

  it("shared-EDIT recipient: row scoped to OWNING firm/client, audit firmId=OWNING, metadata.crossFirmActor=true", async () => {
    await insertEditShare();
    setCrossFirmAuth();

    const req = new NextRequest(
      `http://localhost/api/clients/${COOPER_CLIENT_ID}/accounts`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(TEST_BODY),
      },
    );
    const res = await POST(req, { params: Promise.resolve({ id: COOPER_CLIENT_ID }) });

    // (a) HTTP 201 — write succeeded
    expect(res.status).toBe(201);
    const row = (await res.json()) as typeof accounts.$inferSelect;
    createdAccountIds.push(row.id);

    // (a) Row scoped to OWNING firm/client
    const [dbRow] = await db
      .select({ clientId: accounts.clientId })
      .from(accounts)
      .where(eq(accounts.id, row.id));
    expect(dbRow).toBeTruthy();
    expect(dbRow.clientId).toBe(COOPER_CLIENT_ID);

    // (b) Audit row firmId = OWNING firm
    const auditRows = await db
      .select({ firmId: auditLog.firmId, metadata: auditLog.metadata })
      .from(auditLog)
      .where(eq(auditLog.resourceId, row.id));
    expect(auditRows.length).toBeGreaterThan(0);
    expect(auditRows[0].firmId).toBe(OWNING_FIRM);

    // (c) metadata.crossFirmActor === true
    const meta = auditRows[0].metadata as Record<string, unknown> | null;
    expect(meta).not.toBeNull();
    expect(meta!.crossFirmActor).toBe(true);
  });

  it("shared-VIEW recipient → 403 (edit gate)", async () => {
    await insertViewShare();
    setCrossFirmAuth();

    const req = new NextRequest(
      `http://localhost/api/clients/${COOPER_CLIENT_ID}/accounts`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(TEST_BODY),
      },
    );
    const res = await POST(req, { params: Promise.resolve({ id: COOPER_CLIENT_ID }) });
    expect(res.status).toBe(403);
  });

  it("own-firm write: row created, audit firmId=OWNING, no crossFirmActor key", async () => {
    setOwnFirmAuth("user_own_firm_pilot");

    const req = new NextRequest(
      `http://localhost/api/clients/${COOPER_CLIENT_ID}/accounts`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Own-firm test account", category: "taxable" }),
      },
    );
    const res = await POST(req, { params: Promise.resolve({ id: COOPER_CLIENT_ID }) });
    expect(res.status).toBe(201);
    const row = (await res.json()) as typeof accounts.$inferSelect;
    createdAccountIds.push(row.id);

    const auditRows = await db
      .select({ firmId: auditLog.firmId, metadata: auditLog.metadata })
      .from(auditLog)
      .where(eq(auditLog.resourceId, row.id));
    expect(auditRows.length).toBeGreaterThan(0);
    expect(auditRows[0].firmId).toBe(OWNING_FIRM);

    const meta = auditRows[0].metadata as Record<string, unknown> | null;
    // Own-firm writes must NOT stamp crossFirmActor.
    if (meta !== null) {
      expect(meta.crossFirmActor).toBeUndefined();
    }
  });
});
