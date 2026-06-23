import { describe, it, expect, vi } from "vitest";
vi.mock("@/lib/portal/resolve-portal-client", () => ({ resolvePortalClient: vi.fn(async () => ({ clientId: "c1", mode: "client" })) }));
vi.mock("@/lib/investments/quote", async (orig) => ({
  ...(await orig()),
  fetchEodQuotes: vi.fn(async () => new Map([["VTI.US", { price: 280.5, changePct: 1.2, asOf: "2026-06-23" }]])),
}));
import { GET } from "../route";

it("returns quotes keyed by the requested ticker", async () => {
  const res = await GET(new Request("http://x/api/portal/investments/quotes?tickers=VTI"));
  const body = await res.json();
  expect(body.quotes.VTI).toMatchObject({ price: 280.5, changePct: 1.2 });
});
