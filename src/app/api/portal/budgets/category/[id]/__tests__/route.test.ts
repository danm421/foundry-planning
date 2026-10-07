import { describe, it, expect, vi, beforeEach } from "vitest";
// Section switches all on — they have their own tests (require-portal-feature,
// feature-gate-403, feature-gate-coverage).
vi.mock("@/lib/portal/load-features", () => import("@/lib/portal/__tests__/load-features-mock"));

const { ALL_ON } = vi.hoisted(() => ({
  ALL_ON: { shareTransactions: true, shareBudgets: true, shareRecurrings: true },
}));
const resolveMock = vi.fn();
vi.mock("@/lib/portal/resolve-portal-client", () => ({
  resolvePortalClient: () => resolveMock(),
}));
vi.mock("@/lib/authz", () => ({ authErrorResponse: () => null }));
vi.mock("@/lib/portal/require-portal-subscription", () => ({
  requirePortalActiveSubscription: () => Promise.resolve(),
}));

// The gate hands back the switches that apply to the caller: the client's own
// for an advisor, every switch on for the real client.
const advisorPrivacyMock = vi.fn();
vi.mock("@/lib/portal/privacy", () => ({
  requireAreaShared: async (mode: string) => (mode === "advisor" ? advisorPrivacyMock() : ALL_ON),
}));

const TXN = {
  id: "t1",
  date: "2026-09-01",
  name: "Pharmacy",
  merchantName: "Pharmacy",
  amount: 12.5,
  categoryId: "cat1",
  categoryName: "Health",
  categoryColor: "#000",
};
// Mirrors the loader: rows only when the caller may see them.
const loadDetailMock = vi.fn(
  async (_c: string, _id: string, _now: Date, opts: { includeTransactions?: boolean } = {}) => ({
    id: "cat1",
    history: [{ month: "2026-09", spent: 12.5 }],
    transactions: opts.includeTransactions === false ? [] : [TXN],
  }),
);
vi.mock("@/lib/portal/load-category-detail", () => ({
  loadCategoryDetail: (...a: Parameters<typeof loadDetailMock>) => loadDetailMock(...a),
}));

import { GET } from "@/app/api/portal/budgets/category/[id]/route";

const call = () =>
  GET(new Request("http://t/api/portal/budgets/category/cat1"), {
    params: Promise.resolve({ id: "cat1" }),
  });

beforeEach(() => {
  resolveMock.mockResolvedValue({ clientId: "c1", mode: "client", clerkUserId: "u1" });
  // The client shares Budget but keeps Transactions private.
  advisorPrivacyMock.mockReset();
  advisorPrivacyMock.mockResolvedValue({ ...ALL_ON, shareTransactions: false });
  loadDetailMock.mockClear();
});

describe("GET /api/portal/budgets/category/[id]", () => {
  it("shows an advisor the category totals but no transactions the client keeps private", async () => {
    resolveMock.mockResolvedValue({ clientId: "c1", mode: "advisor", clerkUserId: "u1" });
    const res = await call();
    expect(res.status).toBe(200);
    const { detail } = await res.json();
    expect(detail.transactions).toEqual([]);
    expect(detail.history).toHaveLength(1);
    expect(loadDetailMock).toHaveBeenCalledWith("c1", "cat1", expect.any(Date), {
      includeTransactions: false,
    });
  });

  it("shows an advisor the transactions once the client shares them", async () => {
    resolveMock.mockResolvedValue({ clientId: "c1", mode: "advisor", clerkUserId: "u1" });
    advisorPrivacyMock.mockResolvedValue(ALL_ON);
    const { detail } = await (await call()).json();
    expect(detail.transactions).toEqual([TXN]);
  });

  it("always shows the client their own transactions", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    const { detail } = await res.json();
    expect(detail.transactions).toEqual([TXN]);
    expect(loadDetailMock).toHaveBeenCalledWith("c1", "cat1", expect.any(Date), {
      includeTransactions: true,
    });
  });
});
