import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { NextRequest } from "next/server";
import { db } from "@/db";
import {
  clients,
  clientOpenItems,
  crmHouseholds,
  crmHouseholdContacts,
} from "@/db/schema";
import { eq } from "drizzle-orm";

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({
    userId: "user_test_overview",
    orgId: "firm_test_overview",
    sessionClaims: { org_public_metadata: { is_founder: true } },
  })),
}));

const FIRM_A = "firm_test_overview";
const FIRM_B = "firm_test_overview_other";

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
  await db.delete(clientOpenItems).where(eq(clientOpenItems.clientId, clientA));
  await db.delete(clientOpenItems).where(eq(clientOpenItems.clientId, clientB));
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

describe("POST /api/clients/[id]/open-items", () => {
  it("creates an item with minimal body", async () => {
    const res = await POST(makeReq({ title: "Collect docs" }), {
      params: Promise.resolve({ id: clientA }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.title).toBe("Collect docs");
    expect(body.priority).toBe("medium");
    expect(body.completedAt).toBeNull();
  });

  it("403s when the client is in a different firm", async () => {
    const res = await POST(makeReq({ title: "hack" }), {
      params: Promise.resolve({ id: clientB }),
    });
    expect(res.status).toBe(403);
  });

  it("400s on invalid body", async () => {
    const res = await POST(makeReq({ title: "" }), {
      params: Promise.resolve({ id: clientA }),
    });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/clients/[id]/open-items", () => {
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
