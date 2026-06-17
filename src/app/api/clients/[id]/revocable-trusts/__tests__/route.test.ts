import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { NextRequest } from "next/server";
import { db } from "@/db";
import {
  clients,
  accounts,
  revocableTrusts,
  scenarios,
  crmHouseholds,
  crmHouseholdContacts,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({
    userId: "user_test_rt",
    orgId: "firm_test_rt",
    sessionClaims: { org_public_metadata: { is_founder: true } },
  })),
}));

const FIRM_A = "firm_test_rt";
const FIRM_B = "firm_other_rt";

let clientId: string;
let otherClientId: string;
let scenarioId: string;
let accountId1: string;
let accountId2: string;

beforeAll(async () => {
  // Create household + client for FIRM_A
  const [household] = await db
    .insert(crmHouseholds)
    .values({ firmId: FIRM_A, advisorId: "adv_rt", name: "RT Test Household" })
    .returning();
  await db.insert(crmHouseholdContacts).values({
    householdId: household.id,
    role: "primary",
    firstName: "RT",
    lastName: "Tester",
    dateOfBirth: "1970-01-01",
  });
  const [client] = await db
    .insert(clients)
    .values({
      firmId: FIRM_A,
      advisorId: "adv_rt",
      crmHouseholdId: household.id,
      retirementAge: 65,
      planEndAge: 95,
    })
    .returning();
  clientId = client.id;

  // Create a scenario so we can create accounts
  const [scenario] = await db
    .insert(scenarios)
    .values({ clientId, name: "Base", isBaseCase: true })
    .returning();
  scenarioId = scenario.id;

  // Create two accounts for membership-diff tests
  const [acct1] = await db
    .insert(accounts)
    .values({
      clientId,
      scenarioId,
      name: "Checking",
      category: "cash",
      subType: "checking",
      value: "0",
      basis: "0",
    })
    .returning();
  accountId1 = acct1.id;

  const [acct2] = await db
    .insert(accounts)
    .values({
      clientId,
      scenarioId,
      name: "Brokerage",
      category: "taxable",
      subType: "brokerage",
      value: "100000",
      basis: "80000",
    })
    .returning();
  accountId2 = acct2.id;

  // Create a client for FIRM_B (for cross-firm 404 tests)
  const [otherHousehold] = await db
    .insert(crmHouseholds)
    .values({ firmId: FIRM_B, advisorId: "adv_other", name: "Other Household" })
    .returning();
  await db.insert(crmHouseholdContacts).values({
    householdId: otherHousehold.id,
    role: "primary",
    firstName: "Other",
    lastName: "Client",
    dateOfBirth: "1970-01-01",
  });
  const [otherClient] = await db
    .insert(clients)
    .values({
      firmId: FIRM_B,
      advisorId: "adv_other",
      crmHouseholdId: otherHousehold.id,
      retirementAge: 65,
      planEndAge: 95,
    })
    .returning();
  otherClientId = otherClient.id;
  void otherClientId;
  void scenarioId;
});

afterAll(async () => {
  // Clean up all test data
  await db.delete(revocableTrusts).where(eq(revocableTrusts.clientId, clientId));
  await db.delete(accounts).where(eq(accounts.clientId, clientId));
  await db.delete(scenarios).where(eq(scenarios.clientId, clientId));
  await db.delete(clients).where(eq(clients.id, clientId));

  const [otherScenarios] = await db
    .select()
    .from(scenarios)
    .where(eq(scenarios.clientId, otherClientId));
  if (otherScenarios) {
    await db.delete(accounts).where(eq(accounts.clientId, otherClientId));
    await db.delete(scenarios).where(eq(scenarios.clientId, otherClientId));
  }
  await db.delete(revocableTrusts).where(eq(revocableTrusts.clientId, otherClientId));
  await db.delete(clients).where(eq(clients.id, otherClientId));
});

// Import route handlers AFTER mock + fixture setup
import { GET, POST } from "../route";
import { PATCH, DELETE } from "../[trustId]/route";

function makeReq(method: string, body?: unknown): NextRequest {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { "content-type": "application/json" };
  }
  return new Request("http://test/api", init) as unknown as NextRequest;
}

// ── GET tests ─────────────────────────────────────────────────────────────────

describe("GET /api/clients/[id]/revocable-trusts", () => {
  it("returns empty array when no trusts exist", async () => {
    const res = await GET(makeReq("GET"), {
      params: Promise.resolve({ id: clientId }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it("returns 404 for a client from another firm", async () => {
    const res = await GET(makeReq("GET"), {
      params: Promise.resolve({ id: otherClientId }),
    });
    expect(res.status).toBe(404);
  });
});

// ── POST tests ────────────────────────────────────────────────────────────────

describe("POST /api/clients/[id]/revocable-trusts", () => {
  it("creates a trust with no accounts tagged", async () => {
    const res = await POST(makeReq("POST", { name: "Smith Family Trust" }), {
      params: Promise.resolve({ id: clientId }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.name).toBe("Smith Family Trust");
    expect(body.id).toBeDefined();
    expect(body.accountIds).toEqual([]);

    // Cleanup
    await db.delete(revocableTrusts).where(eq(revocableTrusts.id, body.id));
  });

  it("creates a trust and tags the given accounts", async () => {
    const res = await POST(
      makeReq("POST", {
        name: "Joint Living Trust",
        accountIds: [accountId1, accountId2],
      }),
      { params: Promise.resolve({ id: clientId }) }
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.name).toBe("Joint Living Trust");
    expect(body.accountIds).toHaveLength(2);
    expect(body.accountIds).toContain(accountId1);
    expect(body.accountIds).toContain(accountId2);

    // Verify accounts were tagged in DB
    const [acct1Row] = await db
      .select({ revocableTrustId: accounts.revocableTrustId })
      .from(accounts)
      .where(eq(accounts.id, accountId1));
    expect(acct1Row.revocableTrustId).toBe(body.id);

    // Store trust id for PATCH/DELETE tests
    (globalThis as Record<string, unknown>).__testTrustId = body.id;
  });

  it("returns 400 for missing name", async () => {
    const res = await POST(makeReq("POST", { accountIds: [] }), {
      params: Promise.resolve({ id: clientId }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid body");
  });

  it("returns 400 for name exceeding 120 chars", async () => {
    const res = await POST(makeReq("POST", { name: "x".repeat(121) }), {
      params: Promise.resolve({ id: clientId }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 403 for a client from another firm", async () => {
    const res = await POST(
      makeReq("POST", { name: "Cross-Firm Trust" }),
      { params: Promise.resolve({ id: otherClientId }) }
    );
    expect(res.status).toBe(403);
  });
});

// ── PATCH tests ───────────────────────────────────────────────────────────────

describe("PATCH /api/clients/[id]/revocable-trusts/[trustId]", () => {
  let trustId: string;

  beforeAll(async () => {
    // Create a fresh trust with account1 tagged
    const [trust] = await db
      .insert(revocableTrusts)
      .values({ clientId, name: "Test Trust for PATCH" })
      .returning();
    trustId = trust.id;

    // Tag account1 into this trust
    await db
      .update(accounts)
      .set({ revocableTrustId: trustId })
      .where(and(eq(accounts.clientId, clientId), eq(accounts.id, accountId1)));
  });

  afterAll(async () => {
    // Untag accounts and remove trust
    await db
      .update(accounts)
      .set({ revocableTrustId: null })
      .where(eq(accounts.clientId, clientId));
    await db.delete(revocableTrusts).where(eq(revocableTrusts.id, trustId));
  });

  it("renames the trust", async () => {
    const res = await PATCH(
      makeReq("PATCH", { name: "Renamed Trust", accountIds: [accountId1] }),
      { params: Promise.resolve({ id: clientId, trustId }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe("Renamed Trust");
  });

  it("diffs membership: untags removed, tags added", async () => {
    // account1 is currently tagged; swap to account2
    const res = await PATCH(
      makeReq("PATCH", { name: "Renamed Trust", accountIds: [accountId2] }),
      { params: Promise.resolve({ id: clientId, trustId }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.accountIds).toContain(accountId2);
    expect(body.accountIds).not.toContain(accountId1);

    // Verify DB state
    const [acct1Row] = await db
      .select({ revocableTrustId: accounts.revocableTrustId })
      .from(accounts)
      .where(eq(accounts.id, accountId1));
    expect(acct1Row.revocableTrustId).toBeNull();

    const [acct2Row] = await db
      .select({ revocableTrustId: accounts.revocableTrustId })
      .from(accounts)
      .where(eq(accounts.id, accountId2));
    expect(acct2Row.revocableTrustId).toBe(trustId);
  });

  it("untags all accounts when accountIds is empty", async () => {
    // account2 is currently tagged; clear all
    const res = await PATCH(
      makeReq("PATCH", { name: "Renamed Trust", accountIds: [] }),
      { params: Promise.resolve({ id: clientId, trustId }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.accountIds).toEqual([]);

    // Verify DB
    const [acct2Row] = await db
      .select({ revocableTrustId: accounts.revocableTrustId })
      .from(accounts)
      .where(eq(accounts.id, accountId2));
    expect(acct2Row.revocableTrustId).toBeNull();
  });

  it("returns 403 when trustId does not belong to client", async () => {
    const res = await PATCH(
      makeReq("PATCH", { name: "Hack", accountIds: [] }),
      { params: Promise.resolve({ id: otherClientId, trustId }) }
    );
    expect(res.status).toBe(403);
  });

  it("returns 400 for invalid body", async () => {
    const res = await PATCH(makeReq("PATCH", { name: "" }), {
      params: Promise.resolve({ id: clientId, trustId }),
    });
    expect(res.status).toBe(400);
  });
});

// ── DELETE tests ──────────────────────────────────────────────────────────────

describe("DELETE /api/clients/[id]/revocable-trusts/[trustId]", () => {
  it("deletes the trust and the FK ON DELETE SET NULL untags accounts", async () => {
    // Create a trust and tag account1
    const [trust] = await db
      .insert(revocableTrusts)
      .values({ clientId, name: "Trust to Delete" })
      .returning();
    await db
      .update(accounts)
      .set({ revocableTrustId: trust.id })
      .where(and(eq(accounts.clientId, clientId), eq(accounts.id, accountId1)));

    const res = await DELETE(makeReq("DELETE"), {
      params: Promise.resolve({ id: clientId, trustId: trust.id }),
    });
    expect(res.status).toBe(204);

    // Trust row should be gone
    const [gone] = await db
      .select()
      .from(revocableTrusts)
      .where(eq(revocableTrusts.id, trust.id));
    expect(gone).toBeUndefined();

    // Account should have been untagged by FK cascade
    const [acct1Row] = await db
      .select({ revocableTrustId: accounts.revocableTrustId })
      .from(accounts)
      .where(eq(accounts.id, accountId1));
    expect(acct1Row.revocableTrustId).toBeNull();
  });

  it("returns 403 when trust does not belong to this client/firm", async () => {
    // Create a trust under FIRM_A client
    const [trust] = await db
      .insert(revocableTrusts)
      .values({ clientId, name: "Trust for Cross-Firm Test" })
      .returning();

    // Try to delete it as FIRM_B client (requireClientEditAccess throws ForbiddenError → 403)
    const res = await DELETE(makeReq("DELETE"), {
      params: Promise.resolve({ id: otherClientId, trustId: trust.id }),
    });
    expect(res.status).toBe(403);

    // Cleanup
    await db.delete(revocableTrusts).where(eq(revocableTrusts.id, trust.id));
  });
});
