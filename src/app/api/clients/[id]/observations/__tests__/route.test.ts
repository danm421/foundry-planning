import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { NextRequest } from "next/server";
import { db } from "@/db";
import {
  clients,
  planObservations,
  crmHouseholds,
  crmHouseholdContacts,
  auditLog,
} from "@/db/schema";
import { eq } from "drizzle-orm";

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({
    userId: "user_test_observations",
    orgId: "firm_test_observations",
    sessionClaims: { org_public_metadata: { is_founder: true } },
  })),
}));

const FIRM_A = "firm_test_observations";
const FIRM_B = "firm_test_observations_other";

let clientA: string;
let clientB: string;
let householdA: string;
let householdB: string;

async function seedClient(firmId: string, lastName: string): Promise<{ clientId: string; householdId: string }> {
  const [household] = await db
    .insert(crmHouseholds)
    .values({ firmId, advisorId: "advisor_test", name: `${lastName} Household` })
    .returning();
  await db.insert(crmHouseholdContacts).values({
    householdId: household.id,
    role: "primary",
    firstName: "Test",
    lastName,
    dateOfBirth: "1970-01-01",
  });
  const [client] = await db
    .insert(clients)
    .values({
      firmId,
      advisorId: "advisor_test",
      crmHouseholdId: household.id,
      retirementAge: 65,
      planEndAge: 95,
    })
    .returning();
  return { clientId: client.id, householdId: household.id };
}

beforeAll(async () => {
  const a = await seedClient(FIRM_A, "Alpha");
  const b = await seedClient(FIRM_B, "Beta");
  clientA = a.clientId;
  clientB = b.clientId;
  householdA = a.householdId;
  householdB = b.householdId;
});

afterAll(async () => {
  await db.delete(planObservations).where(eq(planObservations.clientId, clientA));
  await db.delete(planObservations).where(eq(planObservations.clientId, clientB));
  await db.delete(clients).where(eq(clients.id, clientA));
  await db.delete(clients).where(eq(clients.id, clientB));
  await db.delete(crmHouseholds).where(eq(crmHouseholds.id, householdA));
  await db.delete(crmHouseholds).where(eq(crmHouseholds.id, householdB));
});

// Import AFTER mock + fixture setup
import { GET, POST } from "../route";

function makeReq(body?: unknown): NextRequest {
  return new Request("http://test/api", {
    method: body ? "POST" : "GET",
    body: body ? JSON.stringify(body) : undefined,
    headers: { "content-type": "application/json" },
  }) as unknown as NextRequest;
}

describe("POST /api/clients/[id]/observations", () => {
  it("creates an observation with minimal body", async () => {
    const res = await POST(
      makeReq({ section: "observation", body: "Client wants to retire at 62." }),
      { params: Promise.resolve({ id: clientA }) },
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.section).toBe("observation");
    expect(body.body).toBe("Client wants to retire at 62.");
    expect(body.topic).toBe("general");
    expect(body.source).toBe("manual");
    expect(body.status).toBe("open");
    expect(body.sortOrder).toBe(0);
    expect(body.completedAt).toBeNull();
  });

  it("increments sortOrder within the same section", async () => {
    const res = await POST(
      makeReq({ section: "observation", body: "Second observation." }),
      { params: Promise.resolve({ id: clientA }) },
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.sortOrder).toBe(1);
  });

  it("tracks sortOrder independently per section", async () => {
    const res = await POST(
      makeReq({ section: "next_step", body: "First next step." }),
      { params: Promise.resolve({ id: clientA }) },
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.sortOrder).toBe(0);
  });

  it("records a plan_observation.create audit entry", async () => {
    const res = await POST(
      makeReq({ section: "observation", body: "Audited observation." }),
      { params: Promise.resolve({ id: clientA }) },
    );
    const body = await res.json();
    const rows = await db
      .select({
        action: auditLog.action,
        resourceType: auditLog.resourceType,
        resourceId: auditLog.resourceId,
      })
      .from(auditLog)
      .where(eq(auditLog.resourceId, body.id));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].action).toBe("plan_observation.create");
    expect(rows[0].resourceType).toBe("plan_observation");
  });

  it("403s when the client is in a different firm", async () => {
    const res = await POST(makeReq({ section: "observation", body: "hack" }), {
      params: Promise.resolve({ id: clientB }),
    });
    expect(res.status).toBe(403);
  });

  it("400s on invalid body (empty body text)", async () => {
    const res = await POST(makeReq({ section: "observation", body: "" }), {
      params: Promise.resolve({ id: clientA }),
    });
    expect(res.status).toBe(400);
  });

  it("400s on invalid section", async () => {
    const res = await POST(makeReq({ section: "bogus", body: "x" }), {
      params: Promise.resolve({ id: clientA }),
    });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/clients/[id]/observations", () => {
  beforeAll(async () => {
    // Deterministic fixture, inserted out of order, to prove the route's
    // ORDER BY (section, sortOrder, createdAt) rather than insertion order.
    await db.insert(planObservations).values([
      { clientId: clientA, section: "next_step", body: "next-step B", sortOrder: 1 },
      { clientId: clientA, section: "observation", body: "obs B", sortOrder: 1 },
      { clientId: clientA, section: "next_step", body: "next-step A", sortOrder: 0 },
      { clientId: clientA, section: "observation", body: "obs A", sortOrder: 0 },
    ]);
  });

  it("orders by (section asc, sortOrder asc, createdAt asc)", async () => {
    const res = await GET(makeReq(), { params: Promise.resolve({ id: clientA }) });
    expect(res.status).toBe(200);
    const body: { body: string }[] = await res.json();
    const filtered = body
      .map((r) => r.body)
      .filter((b) => ["obs A", "obs B", "next-step A", "next-step B"].includes(b));
    expect(filtered).toEqual(["obs A", "obs B", "next-step A", "next-step B"]);
  });

  it("lists items for the client", async () => {
    const res = await GET(makeReq(), {
      params: Promise.resolve({ id: clientA }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
  });

  it("404s on cross-firm read", async () => {
    const res = await GET(makeReq(), {
      params: Promise.resolve({ id: clientB }),
    });
    expect(res.status).toBe(404);
  });
});
