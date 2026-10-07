import { describe, it, expect, vi, beforeEach } from "vitest";
// Section switches all on — they have their own tests (require-portal-feature,
// feature-gate-403, feature-gate-coverage).
vi.mock("@/lib/portal/load-features", () => import("@/lib/portal/__tests__/load-features-mock"));
vi.mock("@/lib/portal/resolve-portal-client", () => ({ resolvePortalClient: vi.fn(async () => ({ clientId: "c1", mode: "client" })) }));
vi.mock("@/lib/investments/quote", async (orig) => ({
  ...(await orig()),
  fetchEodQuotes: vi.fn(async () => new Map([["VTI.US", { price: 280.5, changePct: 1.2, asOf: "2026-06-23" }]])),
}));
// The household holds VTI and BND (BND in a second account).
vi.mock("@/lib/portal/load-portal-investments", () => ({
  loadPortalInvestments: vi.fn(async () => ({
    totalValue: 0,
    totalSeries: [],
    overallAllocations: [],
    accounts: [
      { id: "a1", holdings: [{ ticker: "VTI" }, { ticker: null }] },
      { id: "a2", holdings: [{ ticker: "bnd" }] },
    ],
  })),
}));
import { GET } from "../route";
import { UnauthorizedError } from "@/lib/db-helpers";
import { resolvePortalClient } from "@/lib/portal/resolve-portal-client";
import { fetchEodQuotes } from "@/lib/investments/quote";
import { loadPortalInvestments } from "@/lib/portal/load-portal-investments";

beforeEach(() => {
  vi.mocked(fetchEodQuotes).mockClear();
  vi.mocked(loadPortalInvestments).mockClear();
});

describe("GET /api/portal/investments/quotes", () => {
  it("returns quotes keyed by the requested ticker", async () => {
    const res = await GET(new Request("http://x/api/portal/investments/quotes?tickers=VTI"));
    const body = await res.json();
    expect(body.quotes.VTI).toMatchObject({ price: 280.5, changePct: 1.2 });
    expect(loadPortalInvestments).toHaveBeenCalledWith("c1");
  });

  it("prices only tickers the household holds, once each", async () => {
    const madeUp = Array.from({ length: 200 }, (_, i) => `ZQ${String(i).padStart(3, "0")}`);
    const tickers = ["VTI", "BND", " vti", ...madeUp].join(",");
    const res = await GET(new Request(`http://x/api/portal/investments/quotes?tickers=${tickers}`));
    expect(res.status).toBe(200);
    expect(fetchEodQuotes).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetchEodQuotes).mock.calls[0][0]).toEqual(["VTI", "BND"]);
  });

  it("returns 401 when resolvePortalClient throws UnauthorizedError", async () => {
    vi.mocked(resolvePortalClient).mockRejectedValueOnce(new UnauthorizedError());
    const res = await GET(new Request("http://x/api/portal/investments/quotes?tickers=VTI"));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("Unauthorized");
  });
});
