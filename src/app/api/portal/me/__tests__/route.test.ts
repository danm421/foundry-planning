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
// resolveIntakeBrandingForClient is the advisor-aware resolver (Task 10):
// null means no usable logo ANYWHERE (advisor override or firm) — the route
// falls back to the logo-independent name resolution (getBranding +
// resolveFirmName, mocked above) in that case rather than showing a generic
// default for every logo-less firm.
const brandingForClientMock = vi.fn();
vi.mock("@/lib/branding/resolve-for-client", () => ({
  resolveIntakeBrandingForClient: (firmId: string, advisorId: string) =>
    brandingForClientMock(firmId, advisorId),
}));
vi.mock("@/db/schema", () => ({
  clients: { _name: "clients" },
  crmHouseholdContacts: { _name: "crm_household_contacts" },
}));
vi.mock("drizzle-orm", () => ({ eq: (...a: unknown[]) => a, and: (...a: unknown[]) => a, inArray: (...a: unknown[]) => a }));
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
  brandingForClientMock.mockReset();
  brandingForClientMock.mockResolvedValue({
    logoUrl: "https://blob/logo.png",
    firmName: "Ethos Wealth",
    faviconUrl: null,
  });
  intakePendingMock.mockReset();
  intakePendingMock.mockResolvedValue(false);
});

/** A `clients` row as the route selects it. The three portal feature columns
 *  are NOT NULL default-true in the schema, so a realistic row always carries
 *  them — a fixture that omitted them would let a dropped projection pass. */
const clientRow = (over: Record<string, unknown> = {}) => ({
  firmId: "firm-1",
  advisorId: "adv-1",
  crmHouseholdId: "hh-1",
  portalEditEnabled: true,
  portalInvestmentsEnabled: true,
  portalBudgetEnabled: true,
  portalDocumentsEnabled: true,
  portalCalculatorsEnabled: true,
  ...over,
});

const primaryContact = (over: Record<string, unknown> = {}) => ({
  role: "primary",
  firstName: "Casey",
  lastName: "Cooper",
  preferredName: null,
  email: "casey@example.com",
  ...over,
});

describe("GET /api/portal/me", () => {
  it("returns client identity + advisor-resolved firm branding for a bound client", async () => {
    // Advisor-distinct values (deliberately different from the beforeEach
    // legacy-path mocks) so this test can only pass if the DTO is actually
    // built from the resolver's output — not from the legacy
    // resolveFirmName/getBranding round-trip.
    brandingForClientMock.mockResolvedValue({
      logoUrl: "https://blob/advisor.png",
      firmName: "Advisor Brand",
      faviconUrl: null,
    });
    selectQueue.push([clientRow()]);
    selectQueue.push([primaryContact()]);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      client: { id: "c1", displayName: "Casey Cooper", email: "casey@example.com" },
      firm: { name: "Advisor Brand", logoUrl: "https://blob/advisor.png" },
      mode: "client",
      editEnabled: true,
      intakePending: false,
      features: { investments: true, budget: true, documents: true, calculators: true },
      greetingName: "Casey",
    });
    expect(brandingForClientMock).toHaveBeenCalledWith("firm-1", "adv-1");
    expect(firmNameMock).not.toHaveBeenCalled();
  });

  it("sets intakePending true when the client has an unsubmitted prefilled form", async () => {
    intakePendingMock.mockResolvedValue(true);
    selectQueue.push([clientRow()]);
    selectQueue.push([primaryContact()]);
    const res = await GET();
    const body = await res.json();
    expect(body.intakePending).toBe(true);
    expect(intakePendingMock).toHaveBeenCalled();
  });

  it("degrades gracefully with no primary contact and no branding anywhere", async () => {
    selectQueue.push([clientRow({ portalEditEnabled: false })]);
    selectQueue.push([]); // no primary contact
    brandingForClientMock.mockResolvedValue(null); // no logo, advisor or firm
    getBrandingMock.mockResolvedValue(null);
    firmNameMock.mockResolvedValue("Foundry Planning");
    const res = await GET();
    const body = await res.json();
    expect(body.client.displayName).toBe("");
    expect(body.firm).toEqual({ name: "Foundry Planning", logoUrl: null });
    expect(body.editEnabled).toBe(false);
  });

  // Regression guard: resolveIntakeBrandingForClient collapses to `null`
  // whenever there is no usable logo anywhere (advisor override or firm) —
  // that's the right signal for the portal chrome to fall back to the
  // Foundry lockup, but a firm's real name does NOT depend on having a logo.
  // A logo-less firm must still see its own name here, not the generic
  // "Foundry Planning" default (which is what naively mapping
  // `branding?.firmName ?? <fallback>` would produce).
  it("resolves the firm's real name even when it has no logo anywhere", async () => {
    selectQueue.push([clientRow({ firmId: "firm-nologo", advisorId: "adv-2", crmHouseholdId: "hh-2" })]);
    selectQueue.push([primaryContact({ firstName: "Jamie", lastName: "Client", email: "jamie@example.com" })]);
    brandingForClientMock.mockResolvedValue(null); // no advisor override, no firm logo
    getBrandingMock.mockResolvedValue({
      displayName: "Cached Meridian Wealth",
      logoUrl: null,
      faviconUrl: null,
      primaryColor: null,
    });
    firmNameMock.mockResolvedValue("Meridian Wealth Live");

    const res = await GET();
    const body = await res.json();

    expect(body.firm).toEqual({ name: "Meridian Wealth Live", logoUrl: null });
    expect(firmNameMock).toHaveBeenCalledWith("firm-nologo", "Cached Meridian Wealth");
  });

  // The mobile app has no other way to learn a section was switched off: it
  // builds its tab bar from this payload. Without the switches it would show
  // Budget/Investments/Documents and then 403 on every fetch behind them —
  // exactly the "mobile build that predates the switch" case that
  // requirePortalFeature was written to catch.
  it("carries the advisor's feature switches so a client can hide a switched-off section", async () => {
    selectQueue.push([
      clientRow({ portalInvestmentsEnabled: false, portalDocumentsEnabled: false }),
    ]);
    selectQueue.push([primaryContact()]);
    const res = await GET();
    const body = await res.json();
    expect(body.features).toEqual({
      investments: false,
      budget: true,
      documents: false,
      calculators: true,
    });
  });

  // Each switch has to reach its own key. All four columns are boolean, so a
  // cross-wired projection would typecheck clean and hide the wrong section.
  it("maps each switch to its own key", async () => {
    selectQueue.push([
      clientRow({
        portalInvestmentsEnabled: false,
        portalBudgetEnabled: true,
        portalDocumentsEnabled: true,
      }),
    ]);
    selectQueue.push([primaryContact()]);
    const bodyA = await (await GET()).json();
    expect(bodyA.features).toEqual({
      investments: false,
      budget: true,
      documents: true,
      calculators: true,
    });

    selectQueue.push([
      clientRow({
        portalInvestmentsEnabled: true,
        portalBudgetEnabled: false,
        portalDocumentsEnabled: true,
      }),
    ]);
    selectQueue.push([primaryContact()]);
    const bodyB = await (await GET()).json();
    expect(bodyB.features).toEqual({
      investments: true,
      budget: false,
      documents: true,
      calculators: true,
    });

    selectQueue.push([
      clientRow({
        portalInvestmentsEnabled: true,
        portalBudgetEnabled: true,
        portalDocumentsEnabled: true,
        portalCalculatorsEnabled: false,
      }),
    ]);
    selectQueue.push([primaryContact()]);
    const bodyC = await (await GET()).json();
    expect(bodyC.features).toEqual({
      investments: true,
      budget: true,
      documents: true,
      calculators: false,
    });
  });

  // The web portal's welcome line names the whole household ("John & Jane"),
  // via portalGreetingName. The phone greeted the primary contact alone, so a
  // two-person household saw a different name on each device.
  it("greets both spouses, primary first", async () => {
    selectQueue.push([clientRow()]);
    selectQueue.push([
      primaryContact({ firstName: "John", lastName: "Doe" }),
      { role: "spouse", firstName: "Jane", lastName: "Doe", preferredName: null, email: null },
    ]);
    const body = await (await GET()).json();
    expect(body.greetingName).toBe("John & Jane");
    // displayName stays the primary contact's own full name — it identifies
    // the signed-in client, which is a different question from who to greet.
    expect(body.client.displayName).toBe("John Doe");
  });

  it("prefers a preferred name in the greeting", async () => {
    selectQueue.push([clientRow()]);
    selectQueue.push([
      primaryContact({ firstName: "Katherine", lastName: "Doe", preferredName: "Kate" }),
    ]);
    const body = await (await GET()).json();
    expect(body.greetingName).toBe("Kate");
  });

  it("greets nobody rather than a dangling separator when there is no contact", async () => {
    selectQueue.push([clientRow()]);
    selectQueue.push([]);
    const body = await (await GET()).json();
    expect(body.greetingName).toBe("");
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
    expect(brandingForClientMock).not.toHaveBeenCalled();
  });

  it("includes advisor mode in response when act-as advisor", async () => {
    resolveMock.mockResolvedValue({ clientId: "c1", mode: "advisor", clerkUserId: "adv" });
    selectQueue.push([clientRow({ portalEditEnabled: undefined })]);
    selectQueue.push([primaryContact()]);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mode).toBe("advisor");
    expect(body.client.id).toBe("c1");
  });
});
