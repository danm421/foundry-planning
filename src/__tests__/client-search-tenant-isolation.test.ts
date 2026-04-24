import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { GET } from "@/app/api/clients/search/route";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { eq } from "drizzle-orm";

vi.mock("@clerk/nextjs/server", async () => {
  const actual = await vi.importActual<typeof import("@clerk/nextjs/server")>("@clerk/nextjs/server");
  return {
    ...actual,
    auth: vi.fn(),
  };
});

import { auth } from "@clerk/nextjs/server";

const FIRM_A = "firm_iso_a";
const FIRM_B = "firm_iso_b";

async function cleanup() {
  await db.delete(clients).where(eq(clients.firmId, FIRM_A));
  await db.delete(clients).where(eq(clients.firmId, FIRM_B));
}
async function seed() {
  await cleanup();
  await db.insert(clients).values([
    { firmId: FIRM_A, advisorId: "a_iso", firstName: "Dana", lastName: "Danger", dateOfBirth: "1970-01-01", retirementAge: 65, planEndAge: 95 },
    { firmId: FIRM_B, advisorId: "b_iso", firstName: "Dana", lastName: "Doolittle", dateOfBirth: "1980-01-01", retirementAge: 65, planEndAge: 95 },
  ] as (typeof clients.$inferInsert)[]);
}

beforeAll(seed);
afterAll(cleanup);

function req(url: string): Request {
  return new Request(url);
}

describe("client search tenant isolation", () => {
  it("Firm A sees only Firm A's matches", async () => {
    (auth as ReturnType<typeof vi.fn>).mockResolvedValue({ userId: "a_iso", orgId: FIRM_A });
    const res = await GET(req("http://localhost/api/clients/search?q=dana"));
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].householdTitle).toContain("Danger");
  });

  it("Firm B sees only Firm B's matches", async () => {
    (auth as ReturnType<typeof vi.fn>).mockResolvedValue({ userId: "b_iso", orgId: FIRM_B });
    const res = await GET(req("http://localhost/api/clients/search?q=dana"));
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].householdTitle).toContain("Doolittle");
  });
});
