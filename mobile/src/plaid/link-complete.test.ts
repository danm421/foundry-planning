import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@/api/client";
import { runPlaidLinkSuccess } from "@/plaid/link-complete";

function fakeApi(overrides: Partial<ApiClient> = {}): ApiClient {
  return { get: vi.fn(), post: vi.fn().mockResolvedValue({}), put: vi.fn(), delete: vi.fn(), ...overrides } as unknown as ApiClient;
}

describe("runPlaidLinkSuccess", () => {
  it("link mode → POST exchange, returns payload", async () => {
    const payload = { itemId: "i1", accounts: [], existingCandidates: [], existingLiabilityCandidates: [] };
    const post = vi.fn().mockResolvedValue(payload);
    const res = await runPlaidLinkSuccess({ api: fakeApi({ post }), mode: "link", publicToken: "pub", institution: { id: "ins_1", name: "Chase" } });
    expect(post).toHaveBeenCalledWith("/api/portal/plaid/exchange", { publicToken: "pub", institution: { id: "ins_1", name: "Chase" } });
    expect(res).toEqual({ kind: "link", payload });
  });
  it("reauth mode → POST reauth-complete, returns done", async () => {
    const post = vi.fn().mockResolvedValue({});
    const res = await runPlaidLinkSuccess({ api: fakeApi({ post }), mode: "reauth", itemId: "i1", publicToken: "pub" });
    expect(post).toHaveBeenCalledWith("/api/portal/plaid/items/i1/reauth-complete", {});
    expect(res).toEqual({ kind: "done" });
  });
  it("enable-products → sync then refresh, returns done", async () => {
    const calls: string[] = [];
    const post = vi.fn().mockImplementation((p: string) => { calls.push(p); return Promise.resolve({}); });
    const res = await runPlaidLinkSuccess({ api: fakeApi({ post }), mode: "enable-products", itemId: "i1", publicToken: "pub" });
    expect(calls).toEqual(["/api/portal/plaid/items/i1/sync", "/api/portal/plaid/items/i1/refresh"]);
    expect(res).toEqual({ kind: "done" });
  });
  it("account-selection → dismiss-new-accounts (best effort), returns done", async () => {
    const post = vi.fn().mockRejectedValue(new Error("swallowed"));
    const res = await runPlaidLinkSuccess({ api: fakeApi({ post }), mode: "account-selection", itemId: "i1", publicToken: "pub" });
    expect(post).toHaveBeenCalledWith("/api/portal/plaid/items/i1/dismiss-new-accounts", {});
    expect(res).toEqual({ kind: "done" });
  });
  it("link mode error → returns error result", async () => {
    const post = vi.fn().mockRejectedValue(new Error("boom"));
    const res = await runPlaidLinkSuccess({ api: fakeApi({ post }), mode: "link", publicToken: "pub" });
    expect(res.kind).toBe("error");
  });
});
