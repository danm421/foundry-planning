import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { GET } from "@/app/api/clients/search/route";
import { db } from "@/db";
import { clients, crmHouseholds, crmHouseholdContacts } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";

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
  await db
    .delete(crmHouseholds)
    .where(inArray(crmHouseholds.firmId, [FIRM_A, FIRM_B]));
}
async function seed() {
  await cleanup();
  // Identity lives on CRM contacts — create a household + primary contact
  // per planning client.
  const householdSeeds = [
    { firmId: FIRM_A, advisorId: "a_iso", name: "Danger Household", firstName: "Dana", lastName: "Danger", dob: "1970-01-01" },
    { firmId: FIRM_B, advisorId: "b_iso", name: "Doolittle Household", firstName: "Dana", lastName: "Doolittle", dob: "1980-01-01" },
  ];
  for (const seed of householdSeeds) {
    const [household] = await db
      .insert(crmHouseholds)
      .values({ firmId: seed.firmId, advisorId: seed.advisorId, name: seed.name })
      .returning();
    await db.insert(crmHouseholdContacts).values({
      householdId: household.id,
      role: "primary",
      firstName: seed.firstName,
      lastName: seed.lastName,
      dateOfBirth: seed.dob,
    });
    await db.insert(clients).values({
      firmId: seed.firmId,
      advisorId: seed.advisorId,
      crmHouseholdId: household.id,
      retirementAge: 65,
      planEndAge: 95,
    });
  }
}

beforeAll(seed);
afterAll(cleanup);

function req(url: string): Request {
  return new Request(url);
}

describe("client search tenant isolation", () => {
  it("Firm A sees only Firm A's matches", async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ userId: "a_iso", orgId: FIRM_A });
    const res = await GET(req("http://localhost/api/clients/search?q=dana"));
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].householdTitle).toContain("Danger");
  });

  it("Firm B sees only Firm B's matches", async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ userId: "b_iso", orgId: FIRM_B });
    const res = await GET(req("http://localhost/api/clients/search?q=dana"));
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].householdTitle).toContain("Doolittle");
  });
});
