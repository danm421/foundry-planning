/**
 * E2E test for the Plaid portal flow at the route-handler level.
 *
 * Sequence: link-token → exchange → commit (create) → refresh → unlink.
 *
 * Uses a REAL Neon dev DB (gated on DATABASE_URL) with REAL Drizzle queries,
 * REAL encrypt/decrypt, and REAL audit helpers.
 *
 * Stubbed boundaries:
 * - @/lib/authz            → requireClientPortalAccess (no Clerk session needed)
 * - @/lib/portal/require-edit-enabled → requireEditEnabled (no DB portal flag check)
 * - @/lib/plaid/client     → getPlaidClient (no Plaid sandbox creds needed)
 * - @/lib/plaid/refresh    → fetchBalancesForItem (avoids double Plaid SDK hit)
 * - @/lib/rate-limit       → always allowed
 * - @/lib/audit/record-helpers → passthrough (real audit writes succeed)
 *
 * Cleanup: afterAll deletes all seeded rows by firmId (FK-safe order).
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";

// ---------------------------------------------------------------------------
// .env.local loader (mirrors clt-tenant-isolation.test.ts pattern)
// ---------------------------------------------------------------------------
try {
  const envPath = resolve(process.cwd(), ".env.local");
  const raw = readFileSync(envPath, "utf8");
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    const [, k, vRaw] = m;
    if (process.env[k]) continue;
    let v = vRaw.trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    process.env[k] = v;
  }
} catch {
  // .env.local not present — describe.skip below handles this.
}

// Inject a valid 32-byte AES-256-GCM key so encrypt/decrypt work without
// a real PLAID_ENCRYPTION_KEY in .env.local. Set before any module import
// so the lazy-init singleton in crypto.ts picks it up.
// "B".repeat(43) + "=" is 44 base64 chars → 33 bytes; we need exactly 32
// so use "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" (43 'A' chars + '=' = 32 bytes when decoded).
if (!process.env.PLAID_ENCRYPTION_KEY) {
  // 32 bytes of 0x00 in base64 = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
  process.env.PLAID_ENCRYPTION_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
}

const HAS_DB = !!process.env.DATABASE_URL;
const d = HAS_DB ? describe : describe.skip;

// ---------------------------------------------------------------------------
// Mocks declared before any dynamic import of the route modules
// ---------------------------------------------------------------------------

// Plaid SDK stub — all methods return sandbox-like responses
const STUB_LINK_TOKEN = "link-sandbox-e2e-test";
const STUB_ACCESS_TOKEN = "access-sandbox-e2e-test";
const STUB_ITEM_ID = "plaid-item-id-e2e-test";
const STUB_PLAID_ACCOUNT_ID = "pa-e2e-checking";
const STUB_BALANCE = 12345.67;
const STUB_REFRESHED_BALANCE = 13000.0;

vi.mock("@/lib/plaid/client", () => ({
  getPlaidClient: () => ({
    linkTokenCreate: vi.fn().mockResolvedValue({
      data: {
        link_token: STUB_LINK_TOKEN,
        expiration: "2026-12-31T00:00:00Z",
      },
    }),
    itemPublicTokenExchange: vi.fn().mockResolvedValue({
      data: { access_token: STUB_ACCESS_TOKEN, item_id: STUB_ITEM_ID },
    }),
    accountsGet: vi.fn().mockResolvedValue({
      data: {
        accounts: [
          {
            account_id: STUB_PLAID_ACCOUNT_ID,
            name: "E2E Checking",
            official_name: "E2E Gold Standard Checking",
            mask: "9999",
            type: "depository",
            subtype: "checking",
            balances: { current: STUB_BALANCE },
          },
        ],
      },
    }),
    itemRemove: vi.fn().mockResolvedValue({ data: {} }),
  }),
}));

// fetchBalancesForItem — avoids invoking the real Plaid SDK in the refresh route
vi.mock("@/lib/plaid/refresh", () => ({
  fetchBalancesForItem: vi.fn().mockResolvedValue({
    ok: true,
    updates: [
      {
        plaidAccountId: STUB_PLAID_ACCOUNT_ID,
        newValue: STUB_REFRESHED_BALANCE.toFixed(2),
      },
    ],
  }),
}));

// Auth boundaries — resolve to the seeded client (patched in beforeAll)
const requireClientPortalAccessMock = vi.fn();
vi.mock("@/lib/authz", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authz")>();
  return {
    ...actual,
    requireClientPortalAccess: (...args: unknown[]) =>
      requireClientPortalAccessMock(...args),
  };
});

vi.mock("@/lib/portal/require-edit-enabled", () => ({
  requireEditEnabled: vi.fn().mockResolvedValue(undefined),
}));

// Rate limits — always allow
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return {
    ...actual,
    checkPortalPlaidLinkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
    checkPortalPlaidRefreshRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  };
});

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

const FIRM_ID = "firm_plaid_e2e_test";

d("Plaid E2E: link-token → exchange → commit → refresh → unlink", () => {
  let dbMod: typeof import("@/db");
  let schema: typeof import("@/db/schema");
  let drizzleOrm: typeof import("drizzle-orm");

  let seededClientId: string;
  let seededScenarioId: string;
  let plaidItemDbId: string; // UUID primary key of the inserted plaid_items row
  let createdAccountId: string; // UUID of the account created by commit

  // ------------------------------------------------------------------
  // Seed fixtures
  // ------------------------------------------------------------------
  beforeAll(async () => {
    dbMod = await import("@/db");
    schema = await import("@/db/schema");
    drizzleOrm = await import("drizzle-orm");

    const { db } = dbMod;
    const { crmHouseholds, crmHouseholdContacts, clients, scenarios } = schema;

    // CRM household (required FK on clients)
    const [household] = await db
      .insert(crmHouseholds)
      .values({
        firmId: FIRM_ID,
        advisorId: "advisor_plaid_e2e",
        name: "E2E Plaid Test Household",
      })
      .returning();

    await db.insert(crmHouseholdContacts).values({
      householdId: household.id,
      role: "primary",
      firstName: "E2E",
      lastName: "PlaidTest",
      dateOfBirth: "1980-01-01",
    });

    // Client with portalEditEnabled = true
    const [client] = await db
      .insert(clients)
      .values({
        firmId: FIRM_ID,
        advisorId: "advisor_plaid_e2e",
        crmHouseholdId: household.id,
        retirementAge: 65,
        planEndAge: 90,
        lifeExpectancy: 90,
        filingStatus: "single",
        portalEditEnabled: true,
      })
      .returning();
    seededClientId = client.id;

    // Base-case scenario (required by commit "create" decision)
    const [scenario] = await db
      .insert(scenarios)
      .values({ clientId: seededClientId, name: "base", isBaseCase: true })
      .returning();
    seededScenarioId = scenario.id;

    // Wire the auth mock to resolve to this client
    requireClientPortalAccessMock.mockResolvedValue({
      clientId: seededClientId,
      clerkUserId: "clerk_user_e2e",
    });
  }, 30_000);

  // ------------------------------------------------------------------
  // Cleanup
  // ------------------------------------------------------------------
  afterAll(async () => {
    const { db } = dbMod;
    const { clients, crmHouseholds } = schema;
    const { inArray } = drizzleOrm;
    // clients.onDelete = cascade → accounts/scenarios/plaid_items cleaned up
    await db.delete(clients).where(inArray(clients.firmId, [FIRM_ID]));
    await db.delete(crmHouseholds).where(inArray(crmHouseholds.firmId, [FIRM_ID]));
  }, 30_000);

  // ------------------------------------------------------------------
  // Step 1: POST /api/portal/plaid/link-token → returns a link_token
  // ------------------------------------------------------------------
  it("Step 1 — POST link-token returns 200 + linkToken", async () => {
    const { POST } = await import(
      "@/app/api/portal/plaid/link-token/route"
    );
    const res = await POST(
      new Request("https://x/api/portal/plaid/link-token", {
        method: "POST",
        body: "{}",
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.linkToken).toBe(STUB_LINK_TOKEN);
  }, 30_000);

  // ------------------------------------------------------------------
  // Step 2: POST /api/portal/plaid/exchange → inserts plaid_items row
  //         with an ENCRYPTED access_token; round-trips via decrypt()
  // ------------------------------------------------------------------
  it("Step 2 — POST exchange inserts plaid_items with encrypted access_token", async () => {
    const { POST } = await import("@/app/api/portal/plaid/exchange/route");
    const res = await POST(
      new Request("https://x/api/portal/plaid/exchange", {
        method: "POST",
        body: JSON.stringify({
          publicToken: "public-sandbox-e2e",
          institution: { id: "ins_e2e", name: "E2E Bank" },
        }),
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.itemId).toBeTruthy();
    plaidItemDbId = json.itemId as string;

    // Verify the plaid_items row exists in the DB
    const { db } = dbMod;
    const { plaidItems } = schema;
    const { eq } = drizzleOrm;
    const [row] = await db
      .select()
      .from(plaidItems)
      .where(eq(plaidItems.id, plaidItemDbId))
      .limit(1);

    expect(row).toBeDefined();
    expect(row.clientId).toBe(seededClientId);
    expect(row.plaidItemId).toBe(STUB_ITEM_ID);
    expect(row.institutionName).toBe("E2E Bank");

    // Decrypt must round-trip to the stub access token
    const { decrypt } = await import("@/lib/plaid/crypto");
    expect(decrypt(row.accessToken)).toBe(STUB_ACCESS_TOKEN);
  }, 30_000);

  // ------------------------------------------------------------------
  // Step 3: POST /api/portal/plaid/exchange/commit with "create" decision
  //         → creates an accounts row linked to the plaid item
  // ------------------------------------------------------------------
  it("Step 3 — POST exchange/commit creates accounts row with plaid IDs", async () => {
    const { POST } = await import(
      "@/app/api/portal/plaid/exchange/commit/route"
    );
    const res = await POST(
      new Request("https://x/api/portal/plaid/exchange/commit", {
        method: "POST",
        body: JSON.stringify({
          itemId: plaidItemDbId,
          decisions: [
            {
              plaidAccountId: STUB_PLAID_ACCOUNT_ID,
              action: "create",
              accountData: {
                name: "E2E Checking",
                mask: "9999",
                type: "depository",
                subtype: "checking",
                balance: STUB_BALANCE,
              },
            },
          ],
        }),
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.linkedAccountIds).toHaveLength(1);
    createdAccountId = json.linkedAccountIds[0] as string;

    // Verify the accounts row in DB
    const { db } = dbMod;
    const { accounts } = schema;
    const { eq } = drizzleOrm;
    const [row] = await db
      .select()
      .from(accounts)
      .where(eq(accounts.id, createdAccountId))
      .limit(1);

    expect(row).toBeDefined();
    expect(row.clientId).toBe(seededClientId);
    expect(row.scenarioId).toBe(seededScenarioId);
    expect(row.plaidItemId).toBe(plaidItemDbId);
    expect(row.plaidAccountId).toBe(STUB_PLAID_ACCOUNT_ID);
    expect(row.category).toBe("cash");
    expect(row.subType).toBe("checking");
    expect(Number(row.value)).toBeCloseTo(STUB_BALANCE, 1);
  }, 30_000);

  // ------------------------------------------------------------------
  // Step 4: POST /api/portal/plaid/items/[id]/refresh
  //         → updates the linked account's value to the refreshed balance
  // ------------------------------------------------------------------
  it("Step 4 — POST items/[id]/refresh updates account value", async () => {
    const { POST } = await import(
      "@/app/api/portal/plaid/items/[id]/refresh/route"
    );
    const res = await POST(
      new Request("https://x/api/portal/plaid/items/refresh", {
        method: "POST",
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { params: Promise.resolve({ id: plaidItemDbId }) } as any,
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.accountsRefreshed).toBe(1);

    // Verify the account's value was updated in DB
    const { db } = dbMod;
    const { accounts } = schema;
    const { eq } = drizzleOrm;
    const [row] = await db
      .select({ value: accounts.value })
      .from(accounts)
      .where(eq(accounts.id, createdAccountId))
      .limit(1);

    expect(Number(row.value)).toBeCloseTo(STUB_REFRESHED_BALANCE, 1);
  }, 30_000);

  // ------------------------------------------------------------------
  // Step 5: DELETE /api/portal/plaid/items/[id]
  //         → account row STILL EXISTS, plaidItemId/plaidAccountId = NULL,
  //           plaid_items row is GONE
  // ------------------------------------------------------------------
  it("Step 5 — DELETE items/[id] unlinking: account preserved, plaid fields cleared, plaid_items gone", async () => {
    const { DELETE } = await import(
      "@/app/api/portal/plaid/items/[id]/route"
    );
    const res = await DELETE(
      new Request("https://x/api/portal/plaid/items/delete", {
        method: "DELETE",
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { params: Promise.resolve({ id: plaidItemDbId }) } as any,
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.detachedCount).toBe(1);

    const { db } = dbMod;
    const { accounts, plaidItems } = schema;
    const { eq } = drizzleOrm;

    // The accounts row must still exist (not deleted)
    const [accountRow] = await db
      .select({
        id: accounts.id,
        plaidItemId: accounts.plaidItemId,
        plaidAccountId: accounts.plaidAccountId,
      })
      .from(accounts)
      .where(eq(accounts.id, createdAccountId))
      .limit(1);

    expect(accountRow).toBeDefined();
    expect(accountRow.plaidItemId).toBeNull();
    expect(accountRow.plaidAccountId).toBeNull();

    // The plaid_items row must be gone
    const [itemRow] = await db
      .select()
      .from(plaidItems)
      .where(eq(plaidItems.id, plaidItemDbId))
      .limit(1);

    expect(itemRow).toBeUndefined();
  }, 30_000);
});
