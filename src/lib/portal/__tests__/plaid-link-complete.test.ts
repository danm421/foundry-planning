import { describe, it, expect, vi } from "vitest";
import { runPlaidLinkSuccess } from "../plaid-link-complete";

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: async () => body,
  } as unknown as Response;
}

const PAYLOAD = {
  itemId: "item-1",
  accounts: [],
  existingCandidates: [],
  existingLiabilityCandidates: [],
};

describe("runPlaidLinkSuccess", () => {
  it("link mode: exchanges the public token and maps institution metadata", async () => {
    const portalFetch = vi.fn().mockResolvedValue(jsonResponse(PAYLOAD));
    const result = await runPlaidLinkSuccess({
      mode: "link",
      publicToken: "public-abc",
      metadata: { institution: { institution_id: "ins_1", name: "Chase" } },
      portalFetch,
    });
    expect(portalFetch).toHaveBeenCalledWith(
      "/api/portal/plaid/exchange",
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse((portalFetch.mock.calls[0][1] as RequestInit).body as string);
    expect(body.publicToken).toBe("public-abc");
    expect(body.institution).toEqual({ id: "ins_1", name: "Chase" });
    expect(result).toEqual({ kind: "link", payload: PAYLOAD });
  });

  it("link mode: returns error when exchange fails", async () => {
    const portalFetch = vi.fn().mockResolvedValue(jsonResponse({}, false));
    const result = await runPlaidLinkSuccess({
      mode: "link",
      publicToken: "public-abc",
      portalFetch,
    });
    expect(result.kind).toBe("error");
  });

  it("account-selection mode: no network call when itemId is missing, returns done", async () => {
    const portalFetch = vi.fn();
    const result = await runPlaidLinkSuccess({
      mode: "account-selection",
      publicToken: "public-abc",
      portalFetch,
    });
    expect(portalFetch).not.toHaveBeenCalled();
    expect(result).toEqual({ kind: "done" });
  });

  it("account-selection posts the dismiss route to clear the new-accounts flag", async () => {
    const portalFetch = vi.fn().mockResolvedValue({ ok: true });
    const result = await runPlaidLinkSuccess({
      mode: "account-selection",
      itemId: "item-1",
      publicToken: "pt",
      portalFetch,
    });
    expect(result).toEqual({ kind: "done" });
    expect(portalFetch).toHaveBeenCalledWith(
      "/api/portal/plaid/items/item-1/dismiss-new-accounts",
      { method: "POST" },
    );
  });

  it("reauth mode: posts reauth-complete and returns done", async () => {
    const portalFetch = vi.fn().mockResolvedValue(jsonResponse({}));
    const result = await runPlaidLinkSuccess({
      mode: "reauth",
      itemId: "item-1",
      publicToken: "public-abc",
      portalFetch,
    });
    expect(portalFetch).toHaveBeenCalledWith(
      "/api/portal/plaid/items/item-1/reauth-complete",
      expect.objectContaining({ method: "POST" }),
    );
    expect(result).toEqual({ kind: "done" });
  });

  it("reauth mode: returns error when reauth-complete fails", async () => {
    const portalFetch = vi.fn().mockResolvedValue(jsonResponse({}, false));
    const result = await runPlaidLinkSuccess({
      mode: "reauth",
      itemId: "item-1",
      publicToken: "public-abc",
      portalFetch,
    });
    expect(result.kind).toBe("error");
  });

  it("enable-products mode: posts sync then refresh, returns done", async () => {
    const portalFetch = vi.fn().mockResolvedValue(jsonResponse({}));
    const result = await runPlaidLinkSuccess({
      mode: "enable-products",
      itemId: "item-1",
      publicToken: "public-abc",
      portalFetch,
    });
    expect(portalFetch).toHaveBeenNthCalledWith(
      1,
      "/api/portal/plaid/items/item-1/sync",
      expect.objectContaining({ method: "POST" }),
    );
    expect(portalFetch).toHaveBeenNthCalledWith(
      2,
      "/api/portal/plaid/items/item-1/refresh",
      expect.objectContaining({ method: "POST" }),
    );
    expect(result).toEqual({ kind: "done" });
  });

  it("enable-products mode: returns error and skips refresh when sync fails", async () => {
    const portalFetch = vi.fn().mockResolvedValue(jsonResponse({}, false));
    const result = await runPlaidLinkSuccess({
      mode: "enable-products",
      itemId: "item-1",
      publicToken: "public-abc",
      portalFetch,
    });
    expect(portalFetch).toHaveBeenCalledTimes(1);
    expect(result.kind).toBe("error");
  });

  it("returns error when an item-scoped mode is missing itemId", async () => {
    const portalFetch = vi.fn();
    const result = await runPlaidLinkSuccess({
      mode: "reauth",
      publicToken: "public-abc",
      portalFetch,
    });
    expect(portalFetch).not.toHaveBeenCalled();
    expect(result.kind).toBe("error");
  });
});
