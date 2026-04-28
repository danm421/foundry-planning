import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { NextRequest } from "next/server";
import { db } from "@/db";
import { clients, entities, familyMembers, scenarios, accounts } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: "user_test_entities", orgId: "firm_test_entities" })),
}));

const FIRM_A = "firm_test_entities";

let clientId: string;
let scenarioId: string;

beforeAll(async () => {
  const [client] = await db
    .insert(clients)
    .values({
      firmId: FIRM_A,
      advisorId: "advisor_test",
      firstName: "Entity",
      lastName: "Tester",
      dateOfBirth: "1965-06-01",
      retirementAge: 65,
      planEndAge: 95,
    })
    .returning();
  clientId = client.id;

  // Insert a dummy family member row so beforeAll mirrors prior structure;
  // no longer used in assertions (legacy fields dropped).
  await db
    .insert(familyMembers)
    .values({
      clientId,
      firstName: "Beneficiary",
      lastName: "Child",
      relationship: "child",
    });

  // The POST handler inserts a default checking account per scenario.
  // Create a scenario fixture so that path exercises correctly.
  const [scenario] = await db
    .insert(scenarios)
    .values({
      clientId,
      name: "Base",
      isBaseCase: true,
    })
    .returning();
  scenarioId = scenario.id;
  void scenarioId; // referenced indirectly via clientId in handler
});

afterAll(async () => {
  // Entity-owned accounts have account_owners rows summing to 100%. Deleting an
  // account cascades to account_owners, which trips the deferred sum-check
  // trigger (it raises when SUM goes NULL). Disable the user triggers around
  // the cleanup transaction. Mirrors the pattern in gifts/__tests__/route.test.ts
  // and accounts/__tests__/owners.test.ts.
  await db.execute(sql`ALTER TABLE account_owners DISABLE TRIGGER account_owners_sum_check`);
  await db.execute(sql`ALTER TABLE account_owners DISABLE TRIGGER account_owners_retirement_check`);
  await db.execute(sql`ALTER TABLE account_owners DISABLE TRIGGER account_owners_default_checking_check`);
  try {
    await db.delete(accounts).where(eq(accounts.clientId, clientId));
    await db.delete(entities).where(eq(entities.clientId, clientId));
    await db.delete(scenarios).where(eq(scenarios.clientId, clientId));
    await db.delete(familyMembers).where(eq(familyMembers.clientId, clientId));
    await db.delete(clients).where(eq(clients.id, clientId));
  } finally {
    await db.execute(sql`ALTER TABLE account_owners ENABLE TRIGGER account_owners_sum_check`);
    await db.execute(sql`ALTER TABLE account_owners ENABLE TRIGGER account_owners_retirement_check`);
    await db.execute(sql`ALTER TABLE account_owners ENABLE TRIGGER account_owners_default_checking_check`);
  }
});

// Import route handlers AFTER mock + fixture setup
import { GET, POST } from "../route";
import { PUT } from "../[entityId]/route";

function makeGetReq(): NextRequest {
  return new Request("http://test/api", { method: "GET" }) as unknown as NextRequest;
}

function makePostReq(body: unknown): NextRequest {
  return new Request("http://test/api", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  }) as unknown as NextRequest;
}

function makePutReq(body: unknown): NextRequest {
  return new Request("http://test/api", {
    method: "PUT",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  }) as unknown as NextRequest;
}

// ── POST tests ────────────────────────────────────────────────────────────────

describe("POST /api/clients/[id]/entities — distribution policy", () => {
  it("creates an irrevocable SLAT with fixed distribution", async () => {
    const res = await POST(
      makePostReq({
        name: "SLAT for Spouse",
        entityType: "trust",
        trustSubType: "slat",
        isIrrevocable: true,
        distributionMode: "fixed",
        distributionAmount: 50000,
      }),
      { params: Promise.resolve({ id: clientId }) }
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.distributionMode).toBe("fixed");
    expect(body.distributionAmount).toBe("50000.00");
    expect(body.distributionPercent).toBeNull();
  });

  // Schema gap closed: entityCreateSchema !isTrust block now rejects distributionMode
  // and related distribution-policy fields when entityType !== "trust". The schema
  // rejects the request before the route handler's defensive null logic is reached.
  it("rejects distribution policy fields on a non-trust entity with 400", async () => {
    const res = await POST(
      makePostReq({
        name: "Family LLC",
        entityType: "llc",
        distributionMode: "fixed",
        distributionAmount: 1000,
      }),
      { params: Promise.resolve({ id: clientId }) }
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid body");
    expect(body.issues.some((i: { path: string[] }) => i.path.includes("distributionMode"))).toBe(true);
  });
});

// ── trustEnds POST tests ──────────────────────────────────────────────────────

describe("POST /api/clients/[id]/entities — trustEnds round-trip", () => {
  it("persists trustEnds on a trust entity", async () => {
    const res = await POST(
      makePostReq({
        name: "ILIT With TrustEnds",
        entityType: "trust",
        trustSubType: "ilit",
        isIrrevocable: true,
        trustEnds: "spouse_death",
      }),
      { params: Promise.resolve({ id: clientId }) }
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.trustEnds).toBe("spouse_death");
  });

  it("forces trustEnds to null for a non-trust entity even if client sends it", async () => {
    // Zod's entityCreateSchema does not explicitly reject trustEnds on non-trust
    // entities (it's an optional field in baseEntityFields), so the route handler
    // must coerce it to null via the conditional write.
    const res = await POST(
      makePostReq({
        name: "Family Partnership",
        entityType: "partnership",
        trustEnds: "client_death",
      }),
      { params: Promise.resolve({ id: clientId }) }
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.trustEnds).toBeNull();
  });
});

// ── trustEnds PUT tests ───────────────────────────────────────────────────────

describe("PUT /api/clients/[id]/entities/[entityId] — trustEnds round-trip", () => {
  it("sets trustEnds on a trust that did not previously have it", async () => {
    const [trustRow] = await db
      .insert(entities)
      .values({
        clientId,
        name: "ILIT No TrustEnds",
        entityType: "trust",
        trustSubType: "ilit",
        isIrrevocable: true,
        isGrantor: false,
        includeInPortfolio: false,
        value: "0",
      })
      .returning();

    const res = await PUT(
      makePutReq({ trustEnds: "client_death" }),
      { params: Promise.resolve({ id: clientId, entityId: trustRow.id }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.trustEnds).toBe("client_death");
  });

  it("clears trustEnds by sending explicit null", async () => {
    const [trustRow] = await db
      .insert(entities)
      .values({
        clientId,
        name: "ILIT With TrustEnds Set",
        entityType: "trust",
        trustSubType: "ilit",
        isIrrevocable: true,
        isGrantor: false,
        includeInPortfolio: false,
        value: "0",
        trustEnds: "survivorship",
      })
      .returning();

    const res = await PUT(
      makePutReq({ trustEnds: null }),
      { params: Promise.resolve({ id: clientId, entityId: trustRow.id }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.trustEnds).toBeNull();
  });
});

// ── PUT tests ─────────────────────────────────────────────────────────────────

describe("PUT /api/clients/[id]/entities/[entityId] — distribution policy", () => {
  it("updates a trust to set distribution policy", async () => {
    // Create a trust with no distribution policy
    const [trustRow] = await db
      .insert(entities)
      .values({
        clientId,
        name: "ILIT No Distribution",
        entityType: "trust",
        trustSubType: "ilit",
        isIrrevocable: true,
        isGrantor: false,
        includeInPortfolio: false,
        value: "0",
      })
      .returning();

    const res = await PUT(
      makePutReq({
        distributionMode: "fixed",
        distributionAmount: 50000,
      }),
      { params: Promise.resolve({ id: clientId, entityId: trustRow.id }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.distributionMode).toBe("fixed");
    expect(body.distributionAmount).toBe("50000.00");
    expect(body.distributionPercent).toBeNull();
  });

  it("clears distribution policy by setting fields to null", async () => {
    // Create a trust that already has a distribution policy
    const [trustRow] = await db
      .insert(entities)
      .values({
        clientId,
        name: "ILIT With Distribution",
        entityType: "trust",
        trustSubType: "ilit",
        isIrrevocable: true,
        isGrantor: false,
        includeInPortfolio: false,
        value: "0",
        distributionMode: "fixed",
        distributionAmount: "75000.00",
      })
      .returning();

    const res = await PUT(
      makePutReq({
        distributionMode: null,
        distributionAmount: null,
        distributionPercent: null,
      }),
      { params: Promise.resolve({ id: clientId, entityId: trustRow.id }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.distributionMode).toBeNull();
    expect(body.distributionAmount).toBeNull();
    expect(body.distributionPercent).toBeNull();
  });

  it("rejects distributionMode on a revocable trust via merged-row gate (I1 fix)", async () => {
    // Create a revocable trust (no distribution policy)
    const [trustRow] = await db
      .insert(entities)
      .values({
        clientId,
        name: "Revocable Living Trust",
        entityType: "trust",
        trustSubType: "revocable",
        isIrrevocable: false,
        isGrantor: true,
        includeInPortfolio: false,
        value: "0",
      })
      .returning();

    const res = await PUT(
      makePutReq({
        distributionMode: "fixed",
        distributionAmount: 50000,
      }),
      { params: Promise.resolve({ id: clientId, entityId: trustRow.id }) }
    );
    // The merged-row check (entityCreateSchema.safeParse(merged)) should fire:
    // merged has isIrrevocable=false but distributionMode="fixed" → schema rejects
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Resulting entity would be invalid");
  });
});

// ── GET tests ─────────────────────────────────────────────────────────────────

describe("GET /api/clients/[id]/entities", () => {
  it("returns all entities including trustEnds and distribution columns", async () => {
    const res = await GET(makeGetReq(), {
      params: Promise.resolve({ id: clientId }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    // At least the entities created above should be present
    expect(body.length).toBeGreaterThan(0);
    // Each row should include the new columns (even if null)
    const first = body[0];
    expect("trustEnds" in first).toBe(true);
    expect("distributionMode" in first).toBe(true);
    expect("distributionAmount" in first).toBe(true);
    expect("distributionPercent" in first).toBe(true);
  });
});
