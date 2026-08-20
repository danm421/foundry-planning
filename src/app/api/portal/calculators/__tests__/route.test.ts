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

// The faithful shape: the real `authErrorResponse` (src/lib/authz.ts:346-348)
// returns `{ status, body } | null`, never a `Response`. Mocking it that way
// (rather than returning a `Response` directly) means the route's own
// `if (r) return NextResponse.json(r.body, { status: r.status })` translation
// is what's under test, matching every sibling route test
// (liabilities/__tests__/route.test.ts:131-133).
const authErrorResponseMock = vi.fn();
vi.mock("@/lib/authz", () => ({
  authErrorResponse: (e: unknown) => authErrorResponseMock(e),
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

const VALID_SAVINGS_STATE = {
  v: 1,
  name: "Home down payment",
  targetToday: 80_000,
  targetYear: 2036,
  currentSavings: 12_000,
  annualReturn: 0.06,
  mode: "solve",
  monthlyContribution: 200,
};

function putTo(key: string, body: unknown): Request {
  return new Request(`http://localhost/api/portal/calculators/${key}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

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
  // Default: no error in flight, so a route that reaches the catch block
  // unexpectedly rethrows instead of silently 403ing — matching the sibling
  // convention (liabilities/__tests__/route.test.ts:99).
  authErrorResponseMock.mockReturnValue(null);
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

  it("hands back the saved setup when it validates", async () => {
    selectRows = [{ state: VALID_STATE }];
    const res = await GET(new Request("http://localhost"), params("debt-paydown"));
    const { state } = await res.json();
    expect(state.strategy).toBe("snowball");
    expect(state.extraMonthly).toBe(300);
  });

  it("403s when the advisor has switched Calculators off", async () => {
    const forbidden = new ForbiddenError("Your advisor has not enabled Calculators for this portal");
    requirePortalFeatureMock.mockRejectedValue(forbidden);
    authErrorResponseMock.mockReturnValue({ status: 403, body: { error: forbidden.message } });
    const res = await GET(new Request("http://localhost"), params("debt-paydown"));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/advisor/i);
  });

  it("403s and reads nothing when the firm subscription is inactive", async () => {
    const forbidden = new ForbiddenError("Active subscription required");
    requirePortalActiveSubscriptionMock.mockRejectedValue(forbidden);
    authErrorResponseMock.mockReturnValue({ status: 403, body: { error: forbidden.message } });
    const res = await GET(new Request("http://localhost"), params("debt-paydown"));
    expect(res.status).toBe(403);
    // The subscription gate sits ahead of the feature gate — neither ran.
    expect(requirePortalFeatureMock).not.toHaveBeenCalled();
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
    // Guards the whole values() object, not just `state` — a top-level
    // `...body` spread that smuggled an extra key in beside `state` would be
    // invisible to the assertion above but not to this one.
    expect(Object.keys(written).sort()).toEqual(["calculatorKey", "clientId", "state"]);
  });

  it("400s a bad payload without touching the table", async () => {
    const res = await PUT(put({ state: { strategy: "fastest" } }), params("debt-paydown"));
    expect(res.status).toBe(400);
    expect(valuesMock).not.toHaveBeenCalled();
  });

  it("403s and writes nothing when the firm subscription is inactive", async () => {
    const forbidden = new ForbiddenError("Active subscription required");
    requirePortalActiveSubscriptionMock.mockRejectedValue(forbidden);
    authErrorResponseMock.mockReturnValue({ status: 403, body: { error: forbidden.message } });
    const res = await PUT(put({ state: VALID_STATE }), params("debt-paydown"));
    expect(res.status).toBe(403);
    expect(valuesMock).not.toHaveBeenCalled();
  });

  // Deliberate: portal_edit_enabled governs plan data, and this is a
  // scratchpad. A read-only client may still run the numbers.
  it("does not consult the portal edit switch", async () => {
    const res = await PUT(put({ state: VALID_STATE }), params("debt-paydown"));
    expect(res.status).toBe(200);
  });
});

describe("the second calculator key", () => {
  it("accepts a valid savings-goal payload", async () => {
    // Fails loudly while the route hardcodes the debt-paydown validator: a
    // savings-goal body has no `strategy`, so it 400s with "Pick a paydown
    // strategy."
    const res = await PUT(
      putTo("savings-goal", { state: VALID_SAVINGS_STATE }),
      params("savings-goal"),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ state: VALID_SAVINGS_STATE });
  });

  it("stores it under its own key", async () => {
    await PUT(putTo("savings-goal", { state: VALID_SAVINGS_STATE }), params("savings-goal"));
    expect(valuesMock).toHaveBeenCalledWith(
      expect.objectContaining({ calculatorKey: "savings-goal" }),
    );
  });

  it("judges each key by ITS OWN validator, not the other's", async () => {
    const wrongWay = await PUT(
      putTo("savings-goal", { state: VALID_STATE }),
      params("savings-goal"),
    );
    expect(wrongWay.status).toBe(400);

    const otherWay = await PUT(
      putTo("debt-paydown", { state: VALID_SAVINGS_STATE }),
      params("debt-paydown"),
    );
    expect(otherWay.status).toBe(400);
  });

  it("GETs the savings-goal default when nothing is stored", async () => {
    selectRows = [];
    const res = await GET(new Request("http://localhost"), params("savings-goal"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { state: Record<string, unknown> };
    expect(body.state.mode).toBe("solve");
    expect(body.state.name).toBe("My goal");
    // Not the debt-paydown default.
    expect(body.state.strategy).toBeUndefined();
  });

  it("still 404s a key that is not registered, including prototype keys", async () => {
    for (const key of ["nope", "constructor", "__proto__", "toString"]) {
      const res = await GET(new Request("http://localhost"), params(key));
      expect(res.status, `key ${key}`).toBe(404);
      // PUT needs its own assertion: without the guard the route would call
      // `calculator.validate` on `undefined`, and `authErrorResponse` returns
      // null for a TypeError, so it rethrows as an unhandled 500 on a
      // caller-controlled path.
      const wrote = await PUT(putTo(key, {}), params(key));
      expect(wrote.status, `PUT key ${key}`).toBe(404);
    }
    expect(resolvePortalClientMock).not.toHaveBeenCalled();
  });
});
