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

const validV5Body = {
  version: 5,
  title: "Test Report",
  groups: [
    {
      id: "00000000-0000-0000-0000-000000000001",
      title: "Group 1",
      cells: [
        {
          id: "00000000-0000-0000-0000-000000000002",
          span: 1,
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
  it("returns the v5 default layout when no row exists", async () => {
    const res = await GET(new NextRequest("http://localhost/x"), makeParams());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.layout.version).toBe(5);
    expect(json.layout.title).toBe("Comparison Report");
    expect(json.layout.groups.length).toBeGreaterThan(0);
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
  it("upserts a valid v5 layout", async () => {
    const res = await PUT(
      new NextRequest("http://localhost/x", { method: "PUT", body: JSON.stringify(validV5Body) }),
      makeParams(),
    );
    expect(res.status).toBe(200);
    const rows = await db
      .select()
      .from(clientComparisonLayouts)
      .where(eq(clientComparisonLayouts.clientId, testClientId));
    expect(rows.length).toBe(1);
    expect(rows[0].layout).toMatchObject({ version: 5, title: "Test Report" });
  });

  it("rejects a malformed payload with 400", async () => {
    const res = await PUT(
      new NextRequest("http://localhost/x", {
        method: "PUT",
        body: JSON.stringify({ version: 5, title: "X", groups: [{ cells: [] }] }),
      }),
      makeParams(),
    );
    expect(res.status).toBe(400);
  });

  it("rejects a cardinality-violating payload with 422", async () => {
    const bad = {
      version: 5,
      title: "Bad",
      groups: [
        {
          id: "00000000-0000-0000-0000-0000000000a1",
          title: "Group 1",
          cells: [
            {
              id: "00000000-0000-0000-0000-0000000000a2",
              span: 1,
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

  it("replaces an existing v5 layout on second PUT", async () => {
    await PUT(
      new NextRequest("http://localhost/x", { method: "PUT", body: JSON.stringify(validV5Body) }),
      makeParams(),
    );
    const second = {
      ...validV5Body,
      title: "Second",
      groups: [
        {
          id: "00000000-0000-0000-0000-0000000000b1",
          title: "Group B",
          cells: [
            {
              id: "00000000-0000-0000-0000-0000000000b2",
              span: 1,
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
