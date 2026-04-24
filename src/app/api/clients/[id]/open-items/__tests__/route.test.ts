import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { NextRequest } from "next/server";
import { db } from "@/db";
import { clients, clientOpenItems } from "@/db/schema";
import { eq } from "drizzle-orm";

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: "user_test_overview", orgId: "firm_test_overview" })),
}));

const FIRM_A = "firm_test_overview";
const FIRM_B = "firm_test_overview_other";

let clientA: string;
let clientB: string;

beforeAll(async () => {
  const [a] = await db
    .insert(clients)
    .values({
      firmId: FIRM_A,
      advisorId: "advisor_test",
      firstName: "Test",
      lastName: "Alpha",
      dateOfBirth: "1970-01-01",
      retirementAge: 65,
      planEndAge: 95,
    })
    .returning();
  const [b] = await db
    .insert(clients)
    .values({
      firmId: FIRM_B,
      advisorId: "advisor_test",
      firstName: "Test",
      lastName: "Beta",
      dateOfBirth: "1970-01-01",
      retirementAge: 65,
      planEndAge: 95,
    })
    .returning();
  clientA = a.id;
  clientB = b.id;
});

afterAll(async () => {
  await db.delete(clientOpenItems).where(eq(clientOpenItems.clientId, clientA));
  await db.delete(clientOpenItems).where(eq(clientOpenItems.clientId, clientB));
  await db.delete(clients).where(eq(clients.id, clientA));
  await db.delete(clients).where(eq(clients.id, clientB));
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

  it("404s when the client is in a different firm", async () => {
    const res = await POST(makeReq({ title: "hack" }), {
      params: Promise.resolve({ id: clientB }),
    });
    expect(res.status).toBe(404);
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
