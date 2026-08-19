import { describe, it, expect, vi, beforeEach } from "vitest";

const { ForbiddenError } = vi.hoisted(() => {
  class ForbiddenError extends Error {
    constructor(m?: string) { super(m); this.name = "ForbiddenError"; }
  }
  return { ForbiddenError };
});

const resolvePortalClientMock = vi.fn();
vi.mock("@/lib/portal/resolve-portal-client", () => ({
  resolvePortalClient: () => resolvePortalClientMock(),
}));

vi.mock("@/lib/authz", () => ({
  authErrorResponse: (e: unknown) =>
    new Response(JSON.stringify({ error: (e as Error).message }), { status: 403 }),
  ForbiddenError,
}));

const requirePortalActiveSubscriptionMock = vi.fn();
vi.mock("@/lib/portal/require-portal-subscription", () => ({
  requirePortalActiveSubscription: (id: string) => requirePortalActiveSubscriptionMock(id),
}));

const requirePortalFeatureMock = vi.fn();
vi.mock("@/lib/portal/load-features", () => ({
  requirePortalFeature: (id: string, f: string) => requirePortalFeatureMock(id, f),
}));

vi.mock("@/db/schema", () => ({
  portalCalculatorStates: {
    clientId: "client_id",
    calculatorKey: "calculator_key",
    state: "state",
  },
}));
vi.mock("drizzle-orm", () => ({ and: (...a: unknown[]) => a, eq: (...a: unknown[]) => a }));

let selectRows: { state: unknown }[] = [];
const onConflictMock = vi.fn().mockResolvedValue(undefined);
const valuesMock = vi.fn().mockReturnValue({ onConflictDoUpdate: onConflictMock });

vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({ where: () => ({ limit: () => Promise.resolve(selectRows) }) }),
    }),
    insert: () => ({ values: valuesMock }),
  },
}));

import { GET, PUT } from "../[key]/route";

const params = (key: string) => ({ params: Promise.resolve({ key }) });

const VALID_STATE = {
  v: 1,
  strategy: "snowball",
  mode: "extra",
  extraMonthly: 300,
  targetMonth: null,
  excludedDebtIds: [],
  overrides: {},
  manualDebts: [],
};

function put(body: unknown): Request {
  return new Request("http://localhost/api/portal/calculators/debt-paydown", {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  selectRows = [];
  resolvePortalClientMock.mockResolvedValue({ clientId: "c1", mode: "client" });
  requirePortalActiveSubscriptionMock.mockResolvedValue(undefined);
  requirePortalFeatureMock.mockResolvedValue(undefined);
});

describe("GET /api/portal/calculators/[key]", () => {
  it("404s a calculator that does not exist", async () => {
    const res = await GET(new Request("http://localhost"), params("mortgage-refi"));
    expect(res.status).toBe(404);
    // The unknown key is rejected before any identity work.
    expect(resolvePortalClientMock).not.toHaveBeenCalled();
  });

  it("hands back the defaults when nothing is saved", async () => {
    const res = await GET(new Request("http://localhost"), params("debt-paydown"));
    expect(res.status).toBe(200);
    expect((await res.json()).state.strategy).toBe("avalanche");
  });

  it("falls back to the defaults when the stored payload no longer validates", async () => {
    selectRows = [{ state: { strategy: "fastest" } }];
    const res = await GET(new Request("http://localhost"), params("debt-paydown"));
    expect((await res.json()).state.strategy).toBe("avalanche");
  });

  it("403s when the advisor has switched Calculators off", async () => {
    requirePortalFeatureMock.mockRejectedValue(new ForbiddenError("not enabled"));
    const res = await GET(new Request("http://localhost"), params("debt-paydown"));
    expect(res.status).toBe(403);
  });
});

describe("PUT /api/portal/calculators/[key]", () => {
  it("saves a valid payload", async () => {
    const res = await PUT(put({ state: VALID_STATE }), params("debt-paydown"));
    expect(res.status).toBe(200);
    expect(valuesMock).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: "c1", calculatorKey: "debt-paydown" }),
    );
  });

  it("stores only fields the validator rebuilt", async () => {
    await PUT(put({ state: { ...VALID_STATE, clientId: "someone-else" } }), params("debt-paydown"));
    const written = valuesMock.mock.calls[0][0] as { state: Record<string, unknown> };
    expect(written.state).not.toHaveProperty("clientId");
  });

  it("400s a bad payload without touching the table", async () => {
    const res = await PUT(put({ state: { strategy: "fastest" } }), params("debt-paydown"));
    expect(res.status).toBe(400);
    expect(valuesMock).not.toHaveBeenCalled();
  });

  // Deliberate: portal_edit_enabled governs plan data, and this is a
  // scratchpad. A read-only client may still run the numbers.
  it("does not consult the portal edit switch", async () => {
    const res = await PUT(put({ state: VALID_STATE }), params("debt-paydown"));
    expect(res.status).toBe(200);
  });
});
