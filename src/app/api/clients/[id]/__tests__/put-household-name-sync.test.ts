import { describe, it, expect, afterEach, vi } from "vitest";
import { db } from "@/db";
import { clients, crmHouseholds, crmHouseholdContacts } from "@/db/schema";
import { eq } from "drizzle-orm";

// Stub auth — handler calls requireOrgId() and Clerk auth().
vi.mock("@/lib/db-helpers", () => ({
  requireOrgId: async () => "test-firm-hh-name-sync",
}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn().mockResolvedValue({
    userId: "user_test",
    orgId: "test-firm-hh-name-sync",
    sessionClaims: { org_public_metadata: { is_founder: true } },
  }),
}));

import { PUT } from "../route";

const FIRM = "test-firm-hh-name-sync";

// Seed a household (with given stored name) + its contacts + a linked client.
// Returns ids and a cleanup fn. buildHouseholdName-shaped names are "auto".
async function seedHousehold(opts: {
  storedName: string;
  contacts: Array<{
    role: "primary" | "spouse";
    firstName: string;
    lastName: string;
    dateOfBirth?: string;
  }>;
}) {
  const [hh] = await db
    .insert(crmHouseholds)
    .values({ firmId: FIRM, advisorId: "u", name: opts.storedName, status: "active" })
    .returning();
  await db.insert(crmHouseholdContacts).values(
    opts.contacts.map((c) => ({
      householdId: hh.id,
      role: c.role,
      firstName: c.firstName,
      lastName: c.lastName,
      dateOfBirth: c.dateOfBirth ?? "1970-01-01",
    })),
  );
  const [client] = await db
    .insert(clients)
    .values({
      firmId: FIRM,
      advisorId: "u",
      crmHouseholdId: hh.id,
      retirementAge: 65,
      planEndAge: 95,
      lifeExpectancy: 95,
      filingStatus: "married_joint",
    })
    .returning();
  return { householdId: hh.id, clientId: client.id };
}

function putRequest(body: unknown) {
  return new Request("http://test", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as Parameters<typeof PUT>[0];
}

async function readName(householdId: string) {
  const [hh] = await db
    .select({ name: crmHouseholds.name })
    .from(crmHouseholds)
    .where(eq(crmHouseholds.id, householdId));
  return hh.name;
}

describe("PUT /api/clients/[id] — household name sync", () => {
  const created: string[] = [];
  async function track<T extends { householdId: string }>(p: Promise<T>): Promise<T> {
    const r = await p;
    created.push(r.householdId);
    return r;
  }

  afterEach(async () => {
    for (const id of created.splice(0)) {
      // clients cascade is handled by FK; delete clients first to be safe.
      await db.delete(clients).where(eq(clients.crmHouseholdId, id));
      await db.delete(crmHouseholds).where(eq(crmHouseholds.id, id));
    }
  });

  it("updates an auto-generated household name when the client is renamed", async () => {
    const { householdId, clientId } = await track(
      seedHousehold({
        storedName: "Michael Jordan",
        contacts: [{ role: "primary", firstName: "Michael", lastName: "Jordan" }],
      }),
    );

    const res = await PUT(putRequest({ lastName: "Jorden" }), {
      params: Promise.resolve({ id: clientId }),
    });
    expect(res.status).toBe(200);
    expect(await readName(householdId)).toBe("Michael Jorden");
  });

  it("updates a couple's auto-generated name when both last names change", async () => {
    const { householdId, clientId } = await track(
      seedHousehold({
        storedName: "Michael & Jane Jordan",
        contacts: [
          { role: "primary", firstName: "Michael", lastName: "Jordan" },
          { role: "spouse", firstName: "Jane", lastName: "Jordan" },
        ],
      }),
    );

    const res = await PUT(putRequest({ lastName: "Jorden", spouseLastName: "Jorden" }), {
      params: Promise.resolve({ id: clientId }),
    });
    expect(res.status).toBe(200);
    expect(await readName(householdId)).toBe("Michael & Jane Jorden");
  });

  it("overwrites a manually customized household name (always-overwrite policy)", async () => {
    const { householdId, clientId } = await track(
      seedHousehold({
        storedName: "The Jordan Family Trust",
        contacts: [{ role: "primary", firstName: "Michael", lastName: "Jordan" }],
      }),
    );

    const res = await PUT(putRequest({ lastName: "Jorden" }), {
      params: Promise.resolve({ id: clientId }),
    });
    expect(res.status).toBe(200);
    expect(await readName(householdId)).toBe("Michael Jorden");
  });

  it("leaves the name alone when only non-name fields change", async () => {
    const { householdId, clientId } = await track(
      seedHousehold({
        storedName: "Michael Jordan",
        contacts: [{ role: "primary", firstName: "Michael", lastName: "Jordan" }],
      }),
    );

    const res = await PUT(putRequest({ email: "mj@example.com" }), {
      params: Promise.resolve({ id: clientId }),
    });
    expect(res.status).toBe(200);
    expect(await readName(householdId)).toBe("Michael Jordan");
  });
});
