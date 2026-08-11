import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db-helpers", () => ({ requireOrgId: vi.fn() }));
vi.mock("@/lib/clients/authz", () => ({ verifyClientAccess: vi.fn() }));
vi.mock("@/lib/investments/rebalance/load-inputs", () => ({ loadRebalanceInputs: vi.fn() }));
vi.mock("@/lib/investments/rebalance/assemble", () => ({ assembleRebalanceResult: vi.fn() }));

import { POST } from "./route";
import { requireOrgId } from "@/lib/db-helpers";
import { verifyClientAccess } from "@/lib/clients/authz";
import { loadRebalanceInputs } from "@/lib/investments/rebalance/load-inputs";
import { assembleRebalanceResult } from "@/lib/investments/rebalance/assemble";

const ctx = { params: Promise.resolve({ id: "client-1" }) };
const req = (body: unknown) => new Request("http://t/compute", { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  // Call history must not leak between cases — one test asserts the loader was
  // never reached, which a prior case's call would silently satisfy away.
  vi.clearAllMocks();
  vi.mocked(requireOrgId).mockResolvedValue("firm-1");
  vi.mocked(verifyClientAccess).mockResolvedValue({
    ok: true,
    permission: "edit",
    firmId: "firm-1",
    access: "own",
  });
});

describe("POST rebalance/compute", () => {
  it("404s when the client is not in the firm", async () => {
    vi.mocked(verifyClientAccess).mockResolvedValue({ ok: false });
    const res = await POST(req({ accountIds: ["a"], target: { portfolioId: "p" } }), ctx);
    expect(res.status).toBe(404);
  });

  it("400s on an invalid body", async () => {
    const res = await POST(req({ accountIds: [] }), ctx);
    expect(res.status).toBe(400);
  });

  describe("outside-portfolio source", () => {
    const target = { portfolioId: "11111111-1111-4111-8111-111111111111" };
    const outside = (holdings: unknown[]) => ({
      adHoc: { taxable: true, holdings },
      target,
    });

    beforeEach(() => {
      // The loader is mocked, so its return is opaque; assemble is mocked too so
      // the route's happy path can be exercised without a DB or the real math.
      vi.mocked(loadRebalanceInputs).mockResolvedValue(
        {} as unknown as Awaited<ReturnType<typeof loadRebalanceInputs>>,
      );
      vi.mocked(assembleRebalanceResult).mockReturnValue(
        {} as unknown as ReturnType<typeof assembleRebalanceResult>,
      );
    });

    it("accepts typed holdings with no account ids and hands them to the loader", async () => {
      const res = await POST(req(outside([{ ticker: "SPY", shares: 10, price: 500 }])), ctx);

      expect(res.status).toBe(200);
      expect(vi.mocked(loadRebalanceInputs).mock.calls[0][2]).toMatchObject({
        adHoc: { taxable: true, holdings: [{ ticker: "SPY", shares: 10, price: 500 }] },
      });
    });

    it("accepts an untickered row that carries a name (bond / cash)", async () => {
      const res = await POST(req(outside([{ name: "Cash", marketValue: 25000 }])), ctx);
      expect(res.status).toBe(200);
    });

    it("400s on a row identified by neither a ticker nor a name", async () => {
      const res = await POST(req(outside([{ marketValue: 25000 }])), ctx);
      expect(res.status).toBe(400);
    });

    it("400s when both account ids and an outside portfolio are supplied", async () => {
      const res = await POST(
        req({
          accountIds: ["22222222-2222-4222-8222-222222222222"],
          adHoc: { taxable: true, holdings: [{ ticker: "SPY" }] },
          target,
        }),
        ctx,
      );

      expect(res.status).toBe(400);
      expect(vi.mocked(loadRebalanceInputs)).not.toHaveBeenCalled();
    });

    it("400s when neither source is supplied", async () => {
      const res = await POST(req({ target }), ctx);
      expect(res.status).toBe(400);
    });

    it("400s on an empty holdings list", async () => {
      const res = await POST(req(outside([])), ctx);
      expect(res.status).toBe(400);
    });

    it("400s on a negative market value", async () => {
      const res = await POST(req(outside([{ ticker: "SPY", marketValue: -1 }])), ctx);
      expect(res.status).toBe(400);
    });
  });
});
