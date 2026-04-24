import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { GET } from "../route";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { eq } from "drizzle-orm";

const FIRM = "firm_api_search";
const USER = "user_api_search";

vi.mock("@clerk/nextjs/server", async () => {
  const actual = await vi.importActual<typeof import("@clerk/nextjs/server")>("@clerk/nextjs/server");
  return {
    ...actual,
    auth: vi.fn(),
  };
});

import { auth } from "@clerk/nextjs/server";

async function cleanup() {
  await db.delete(clients).where(eq(clients.firmId, FIRM));
}
async function seed() {
  await cleanup();
  await db.insert(clients).values([
    { firmId: FIRM, advisorId: USER, firstName: "Casey", lastName: "Carver", dateOfBirth: "1975-03-03", retirementAge: 65, planEndAge: 95 },
  ] as (typeof clients.$inferInsert)[]);
}

beforeAll(seed);
afterAll(cleanup);

function req(url: string): Request {
  return new Request(url);
}

describe("GET /api/clients/search", () => {
  it("returns 401 when unauthenticated", async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ userId: null, orgId: null });
    const res = await GET(req("http://localhost/api/clients/search?q=casey"));
    expect(res.status).toBe(401);
  });

  it("returns matching clients for the authed firm", async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ userId: USER, orgId: FIRM });
    const res = await GET(req("http://localhost/api/clients/search?q=carver"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body[0].householdTitle).toContain("Carver");
  });

  it("returns empty array for empty q", async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ userId: USER, orgId: FIRM });
    const res = await GET(req("http://localhost/api/clients/search?q="));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
  });
});
