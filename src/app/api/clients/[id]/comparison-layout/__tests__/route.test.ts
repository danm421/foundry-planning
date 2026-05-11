import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { GET, PUT } from "../route";
import { db } from "@/db";
import { clients, clientComparisonLayouts } from "@/db/schema";
import { eq } from "drizzle-orm";

const TEST_FIRM = "test-firm-layout";
const TEST_USER = "test-user-layout";
let testClientId: string;

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn().mockResolvedValue({ userId: "test-user-layout", orgId: "test-firm-layout" }),
}));

beforeEach(async () => {
  const [c] = await db
    .insert(clients)
    .values({
      firmId: TEST_FIRM,
      advisorId: TEST_USER,
      firstName: "T",
      lastName: "U",
      dateOfBirth: "1970-01-01",
      retirementAge: 65,
      planEndAge: 95,
    })
    .returning({ id: clients.id });
  testClientId = c.id;
});

afterEach(async () => {
  await db.delete(clientComparisonLayouts).where(eq(clientComparisonLayouts.clientId, testClientId));
  await db.delete(clients).where(eq(clients.id, testClientId));
});

function makeParams() {
  return { params: Promise.resolve({ id: testClientId }) };
}

describe("GET /api/clients/[id]/comparison-layout", () => {
  it("returns the default layout when no row exists", async () => {
    const res = await GET(new NextRequest("http://localhost/x"), makeParams());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.layout.version).toBe(1);
    expect(json.layout.items.length).toBe(8);
  });

  it("404s when the client doesn't belong to the firm", async () => {
    const otherClient = await db
      .insert(clients)
      .values({
        firmId: "different-firm",
        advisorId: TEST_USER,
        firstName: "X",
        lastName: "Y",
        dateOfBirth: "1980-01-01",
        retirementAge: 65,
        planEndAge: 95,
      })
      .returning({ id: clients.id });
    const res = await GET(
      new NextRequest("http://localhost/x"),
      { params: Promise.resolve({ id: otherClient[0].id }) },
    );
    expect(res.status).toBe(404);
    await db.delete(clients).where(eq(clients.id, otherClient[0].id));
  });
});

describe("PUT /api/clients/[id]/comparison-layout", () => {
  it("upserts a valid layout", async () => {
    const body = {
      version: 1,
      items: [
        { instanceId: "11111111-1111-4111-8111-111111111111", kind: "portfolio" },
      ],
    };
    const res = await PUT(
      new NextRequest("http://localhost/x", { method: "PUT", body: JSON.stringify(body) }),
      makeParams(),
    );
    expect(res.status).toBe(200);
    const rows = await db
      .select()
      .from(clientComparisonLayouts)
      .where(eq(clientComparisonLayouts.clientId, testClientId));
    expect(rows.length).toBe(1);
    expect(rows[0].layout).toMatchObject({ items: [{ kind: "portfolio" }] });
  });

  it("rejects malformed payload with 400", async () => {
    const res = await PUT(
      new NextRequest("http://localhost/x", {
        method: "PUT",
        body: JSON.stringify({ version: 1, items: [{ kind: "bogus" }] }),
      }),
      makeParams(),
    );
    expect(res.status).toBe(400);
  });

  it("replaces an existing layout on second PUT", async () => {
    const body1 = {
      version: 1,
      items: [{ instanceId: "11111111-1111-4111-8111-111111111111", kind: "portfolio" }],
    };
    const body2 = {
      version: 1,
      items: [{ instanceId: "22222222-2222-4222-8222-222222222222", kind: "estate-tax" }],
    };
    await PUT(
      new NextRequest("http://localhost/x", { method: "PUT", body: JSON.stringify(body1) }),
      makeParams(),
    );
    await PUT(
      new NextRequest("http://localhost/x", { method: "PUT", body: JSON.stringify(body2) }),
      makeParams(),
    );
    const rows = await db
      .select()
      .from(clientComparisonLayouts)
      .where(eq(clientComparisonLayouts.clientId, testClientId));
    expect(rows.length).toBe(1);
    expect(rows[0].layout).toMatchObject({ items: [{ kind: "estate-tax" }] });
  });
});
