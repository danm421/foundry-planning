// Starting a plan needs a household the caller can see. With the book silo on,
// another advisor's household answers 404 like a missing one, and a household
// in the Trash is refused too. The plan's owner is still the advisor who starts
// it. Unit test: the database, Clerk session and firm setting are faked.
import { describe, it, expect, vi, beforeEach } from "vitest";

const HOUSEHOLD_ID = "11111111-1111-4111-8111-111111111111";

const session = vi.hoisted(() => ({ userId: "user_b", orgId: "firm-1", orgRole: "org:member" }));
const siloOn = vi.hoisted(() => ({ value: true }));
const household = vi.hoisted(() => ({
  row: {} as Record<string, unknown>,
}));
const spies = vi.hoisted(() => ({ create: vi.fn(), mirror: vi.fn() }));

vi.mock("@clerk/nextjs/server", () => ({ auth: async () => session }));
vi.mock("@/lib/db-helpers", async (orig) => ({
  ...(await orig<typeof import("@/lib/db-helpers")>()),
  requireOrgId: async () => "firm-1",
}));
vi.mock("@/lib/authz", async (orig) => ({
  ...(await orig<typeof import("@/lib/authz")>()),
  requireActiveSubscription: async () => undefined,
}));
vi.mock("@/lib/firm-settings", () => ({ firmBookSiloEnabled: async () => siloOn.value }));
vi.mock("@/db", () => ({
  db: {
    query: { crmHouseholds: { findFirst: async () => household.row } },
    transaction: async (fn: (tx: unknown) => unknown) => fn({}),
    select: () => ({ from: () => ({ where: async () => [{ id: "client-1" }] }) }),
  },
}));
vi.mock("@/lib/clients/create-client", () => ({ createClientForHousehold: spies.create }));
vi.mock("@/lib/clients/mirror-contact-to-crm", () => ({ mirrorContactToCrm: spies.mirror }));
vi.mock("@/lib/crm/households", () => ({ recordHouseholdOpen: async () => undefined }));

import { POST } from "../route";

const post = () =>
  POST(
    new Request("http://test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        crmHouseholdId: HOUSEHOLD_ID,
        retirementAge: 65,
        lifeExpectancy: 95,
        filingStatus: "single",
        email: "changed@example.test",
      }),
    }) as unknown as Parameters<typeof POST>[0],
  );

beforeEach(() => {
  Object.assign(session, { userId: "user_b", orgId: "firm-1", orgRole: "org:member" });
  siloOn.value = true;
  household.row = {
    id: HOUSEHOLD_ID,
    firmId: "firm-1",
    advisorId: "user_a",
    deletedAt: null,
    state: null,
    contacts: [{ role: "primary", firstName: "Pat", lastName: "Doe", dateOfBirth: "1970-01-01" }],
  };
  spies.create.mockReset().mockResolvedValue({ clientId: "client-1" });
  spies.mirror.mockReset();
});

describe("POST /api/clients — the household must be in the caller's book", () => {
  it("answers 404 for another advisor's household and writes nothing", async () => {
    const res = await post();
    expect(res.status).toBe(404);
    expect(spies.create).not.toHaveBeenCalled();
    expect(spies.mirror).not.toHaveBeenCalled();
  });

  it("answers 404 for a household in the Trash", async () => {
    session.orgRole = "org:admin";
    household.row.deletedAt = new Date();
    const res = await post();
    expect(res.status).toBe(404);
    expect(spies.create).not.toHaveBeenCalled();
  });

  it("starts a plan on the caller's own household", async () => {
    household.row.advisorId = "user_b";
    const res = await post();
    expect(res.status).toBe(201);
    expect(spies.create).toHaveBeenCalled();
  });

  it("keeps the advisor who starts the plan as its owner", async () => {
    siloOn.value = false;
    const res = await post();
    expect(res.status).toBe(201);
    expect(spies.create.mock.calls[0][0].household.advisorId).toBe("user_b");
  });
});
