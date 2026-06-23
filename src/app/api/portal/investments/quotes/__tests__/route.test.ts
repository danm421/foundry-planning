import { describe, it, expect, vi } from "vitest";
vi.mock("@/lib/portal/resolve-portal-client", () => ({ resolvePortalClient: vi.fn(async () => ({ clientId: "c1", mode: "client" })) }));
vi.mock("@/lib/investments/quote", async (orig) => ({
  ...(await orig()),
  fetchEodQuotes: vi.fn(async () => new Map([["VTI.US", { price: 280.5, changePct: 1.2, asOf: "2026-06-23" }]])),
}));
import { GET } from "../route";
import { UnauthorizedError } from "@/lib/db-helpers";
import { resolvePortalClient } from "@/lib/portal/resolve-portal-client";

describe("GET /api/portal/investments/quotes", () => {
  it("returns quotes keyed by the requested ticker", async () => {
    const res = await GET(new Request("http://x/api/portal/investments/quotes?tickers=VTI"));
    const body = await res.json();
    expect(body.quotes.VTI).toMatchObject({ price: 280.5, changePct: 1.2 });
  });

  it("returns 401 when resolvePortalClient throws UnauthorizedError", async () => {
    vi.mocked(resolvePortalClient).mockRejectedValueOnce(new UnauthorizedError());
    const res = await GET(new Request("http://x/api/portal/investments/quotes?tickers=VTI"));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("Unauthorized");
  });
});
