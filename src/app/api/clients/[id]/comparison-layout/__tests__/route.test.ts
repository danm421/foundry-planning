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

const validV4Body = {
  version: 4,
  title: "Test Report",
  rows: [
    {
      id: "00000000-0000-0000-0000-000000000001",
      cells: [
        {
          id: "00000000-0000-0000-0000-000000000002",
          widget: {
            id: "00000000-0000-0000-0000-000000000003",
            kind: "portfolio",
            planIds: ["base"],
          },
        },
      ],
    },
  ],
};

describe("GET /api/clients/[id]/comparison-layout", () => {
  it("returns the v4 default layout when no row exists", async () => {
    const res = await GET(new NextRequest("http://localhost/x"), makeParams());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.layout.version).toBe(4);
    expect(json.layout.title).toBe("Comparison Report");
    expect(json.layout.rows.length).toBe(5);
  });

  it("404s when the client doesn't belong to the firm", async () => {
    const [other] = await db
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
      { params: Promise.resolve({ id: other.id }) },
    );
    expect(res.status).toBe(404);
    await db.delete(clients).where(eq(clients.id, other.id));
  });
});

describe("PUT /api/clients/[id]/comparison-layout", () => {
  it("upserts a valid v4 layout", async () => {
    const res = await PUT(
      new NextRequest("http://localhost/x", { method: "PUT", body: JSON.stringify(validV4Body) }),
      makeParams(),
    );
    expect(res.status).toBe(200);
    const rows = await db
      .select()
      .from(clientComparisonLayouts)
      .where(eq(clientComparisonLayouts.clientId, testClientId));
    expect(rows.length).toBe(1);
    expect(rows[0].layout).toMatchObject({ version: 4, title: "Test Report" });
  });

  it("rejects a malformed payload with 400", async () => {
    const res = await PUT(
      new NextRequest("http://localhost/x", {
        method: "PUT",
        body: JSON.stringify({ version: 4, title: "X", rows: [{ cells: [] }] }),
      }),
      makeParams(),
    );
    expect(res.status).toBe(400);
  });

  it("rejects a cardinality-violating payload with 422", async () => {
    const bad = {
      version: 4,
      title: "Bad",
      rows: [
        {
          id: "00000000-0000-0000-0000-0000000000a1",
          cells: [
            {
              id: "00000000-0000-0000-0000-0000000000a2",
              widget: {
                id: "00000000-0000-0000-0000-0000000000a3",
                kind: "year-by-year", // many-only
                planIds: ["just-one"], // only one plan → invalid
              },
            },
          ],
        },
      ],
    };
    const res = await PUT(
      new NextRequest("http://localhost/x", { method: "PUT", body: JSON.stringify(bad) }),
      makeParams(),
    );
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(Array.isArray(json.errors)).toBe(true);
  });

  it("replaces an existing v4 layout on second PUT", async () => {
    await PUT(
      new NextRequest("http://localhost/x", { method: "PUT", body: JSON.stringify(validV4Body) }),
      makeParams(),
    );
    const second = {
      ...validV4Body,
      title: "Second",
      rows: [
        {
          id: "00000000-0000-0000-0000-0000000000b1",
          cells: [
            {
              id: "00000000-0000-0000-0000-0000000000b2",
              widget: {
                id: "00000000-0000-0000-0000-0000000000b3",
                kind: "estate-tax",
                planIds: ["base"],
              },
            },
          ],
        },
      ],
    };
    await PUT(
      new NextRequest("http://localhost/x", { method: "PUT", body: JSON.stringify(second) }),
      makeParams(),
    );
    const rows = await db
      .select()
      .from(clientComparisonLayouts)
      .where(eq(clientComparisonLayouts.clientId, testClientId));
    expect(rows.length).toBe(1);
    expect((rows[0].layout as { title: string }).title).toBe("Second");
  });
});
