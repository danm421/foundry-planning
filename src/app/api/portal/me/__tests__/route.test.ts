// src/app/api/portal/me/__tests__/route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const resolveMock = vi.fn();
vi.mock("@/lib/portal/resolve-portal-client", () => ({
  resolvePortalClient: () => resolveMock(),
}));
const authErrMock = vi.fn<(e: unknown) => { status: number; body: { error: string } } | null>(() => null);
vi.mock("@/lib/authz", () => ({ authErrorResponse: (e: unknown) => authErrMock(e) }));
const getBrandingMock = vi.fn();
vi.mock("@/lib/branding/db", () => ({ getBranding: (id: string) => getBrandingMock(id) }));
const firmNameMock = vi.fn();
vi.mock("@/lib/branding/branding", () => ({
  resolveFirmName: (id: string, cached: string | null) => firmNameMock(id, cached),
}));
vi.mock("@/db/schema", () => ({
  clients: { _name: "clients" },
  crmHouseholdContacts: { _name: "crm_household_contacts" },
}));
vi.mock("drizzle-orm", () => ({ eq: (...a: unknown[]) => a, and: (...a: unknown[]) => a }));
const intakePendingMock = vi.fn<() => Promise<boolean>>(() => Promise.resolve(false));
vi.mock("@/lib/intake/queries", () => ({
  hasUnsubmittedPrefilledForm: () => intakePendingMock(),
}));

const selectQueue: unknown[][] = [];
vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({ where: () => ({ limit: () => Promise.resolve(selectQueue.shift() ?? []) }) }),
    }),
  },
}));

import { GET } from "@/app/api/portal/me/route";

beforeEach(() => {
  selectQueue.length = 0;
  resolveMock.mockReset();
  resolveMock.mockResolvedValue({ clientId: "c1", mode: "client", clerkUserId: "u1" });
  authErrMock.mockReset();
  authErrMock.mockReturnValue(null);
  getBrandingMock.mockReset();
  getBrandingMock.mockResolvedValue({ displayName: "Ethos Cached", logoUrl: "https://blob/logo.png" });
  firmNameMock.mockReset();
  firmNameMock.mockResolvedValue("Ethos Wealth");
  intakePendingMock.mockReset();
  intakePendingMock.mockResolvedValue(false);
});

describe("GET /api/portal/me", () => {
  it("returns client identity + firm branding for a bound client", async () => {
    selectQueue.push([{ firmId: "firm-1", crmHouseholdId: "hh-1", portalEditEnabled: true }]);
    selectQueue.push([{ firstName: "Casey", lastName: "Cooper", email: "casey@example.com" }]);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      client: { id: "c1", displayName: "Casey Cooper", email: "casey@example.com" },
      firm: { name: "Ethos Wealth", logoUrl: "https://blob/logo.png" },
      mode: "client",
      editEnabled: true,
      intakePending: false,
    });
    expect(firmNameMock).toHaveBeenCalledWith("firm-1", "Ethos Cached");
  });

  it("sets intakePending true when the client has an unsubmitted prefilled form", async () => {
    intakePendingMock.mockResolvedValue(true);
    selectQueue.push([{ firmId: "firm-1", crmHouseholdId: "hh-1", portalEditEnabled: true }]);
    selectQueue.push([{ firstName: "Casey", lastName: "Cooper", email: "casey@example.com" }]);
    const res = await GET();
    const body = await res.json();
    expect(body.intakePending).toBe(true);
    expect(intakePendingMock).toHaveBeenCalled();
  });

  it("degrades gracefully with no primary contact and no branding", async () => {
    selectQueue.push([{ firmId: "firm-1", crmHouseholdId: "hh-1", portalEditEnabled: false }]);
    selectQueue.push([]); // no primary contact
    getBrandingMock.mockResolvedValue(null);
    firmNameMock.mockResolvedValue("Foundry Planning");
    const res = await GET();
    const body = await res.json();
    expect(body.client.displayName).toBe("");
    expect(body.firm).toEqual({ name: "Foundry Planning", logoUrl: null });
    expect(body.editEnabled).toBe(false);
  });

  it("propagates auth errors through authErrorResponse", async () => {
    resolveMock.mockRejectedValue(new Error("nope"));
    authErrMock.mockReturnValue({ status: 403, body: { error: "forbidden" } });
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("returns 404 when client is not found", async () => {
    // Push nothing to selectQueue so the first select resolves to []
    const res = await GET();
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ error: "Not found" });
    expect(getBrandingMock).not.toHaveBeenCalled();
  });

  it("includes advisor mode in response when act-as advisor", async () => {
    resolveMock.mockResolvedValue({ clientId: "c1", mode: "advisor", clerkUserId: "adv" });
    selectQueue.push([{ firmId: "firm-1", crmHouseholdId: "hh-1" }]);
    selectQueue.push([{ firstName: "Casey", lastName: "Cooper", email: "casey@example.com" }]);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mode).toBe("advisor");
    expect(body.client.id).toBe("c1");
  });
});
