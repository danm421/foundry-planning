/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const resolveMock = vi.fn();
const authErrMock = vi.fn();
let scenarioRow: any;
let acctRows: any[];

vi.mock("@/lib/portal/resolve-portal-client", () => ({ resolvePortalClient: () => resolveMock() }));
vi.mock("@/lib/authz", () => ({ authErrorResponse: (e: unknown) => authErrMock(e) }));
vi.mock("@/db/schema", () => ({
  accounts: { _name: "accounts" }, scenarios: { _name: "scenarios" },
  accountOwners: {}, accountCategoryEnum: { enumValues: [] }, accountSubTypeEnum: { enumValues: [] }, clients: {},
}));
vi.mock("@/lib/ownership", () => ({ validateOwnersShape: () => ({ owners: [] }), validateOwnersTenant: () => null, validateAccountOwnershipRules: () => null }));
vi.mock("@/lib/portal/validate-trust-owners", () => ({ validateTrustOnlyEntityOwners: () => null }));
vi.mock("@/lib/portal/require-edit-enabled", () => ({ requireEditEnabled: () => Promise.resolve() }));
vi.mock("@/lib/portal/require-portal-subscription", () => ({ requirePortalActiveSubscription: () => Promise.resolve() }));
vi.mock("@/lib/audit/record-helpers", () => ({ recordCreate: () => Promise.resolve() }));
vi.mock("@/lib/portal/account-visibility", () => ({ isPortalVisibleCategory: () => true }));
vi.mock("drizzle-orm", () => ({ eq: (...a: unknown[]) => a, and: (...a: unknown[]) => a }));
vi.mock("@/db", () => ({
  db: {
    select: () => ({ from: (tbl: { _name: string }) => ({
      where: () => ({
        limit: () => Promise.resolve(scenarioRow ? [scenarioRow] : []),
        orderBy: () => Promise.resolve(acctRows ?? []),
      }),
    }) }),
  },
}));

import { GET } from "@/app/api/portal/accounts/route";

beforeEach(() => {
  resolveMock.mockReset(); authErrMock.mockReset();
  resolveMock.mockResolvedValue({ clientId: "c1", mode: "client" });
  authErrMock.mockReturnValue(null);
  scenarioRow = { id: "s1" };
  acctRows = [{ id: "a1", name: "Checking", mask: "1234" }];
});

describe("GET /api/portal/accounts", () => {
  it("returns the client's accounts", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ accounts: [{ id: "a1", name: "Checking", mask: "1234" }] });
  });

  it("returns an empty list when there is no base scenario", async () => {
    scenarioRow = undefined;
    const res = await GET();
    expect(await res.json()).toEqual({ accounts: [] });
  });
});
