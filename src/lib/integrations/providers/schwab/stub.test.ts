import { describe, expect, it } from "vitest";
import { ProviderNotConfigured } from "../../errors";
import { schwabProvider } from "./index";

const ctx = {
  firmId: "firm_1",
  providerId: "schwab" as const,
  getToken: async () => "tok",
};

describe("Schwab transport stub", () => {
  it("throws ProviderNotConfigured from every oauth method", async () => {
    // schwab is authKind: "oauth", so `oauth` is always defined for it.
    expect(() => schwabProvider.oauth!.buildAuthorizeUrl({ state: "s", challenge: "c" }))
      .toThrow(ProviderNotConfigured);
    await expect(schwabProvider.oauth!.exchangeCodeForTokens({ code: "c", codeVerifier: "v" }))
      .rejects.toThrow(ProviderNotConfigured);
    await expect(schwabProvider.oauth!.refreshTokens("rt")).rejects.toThrow(ProviderNotConfigured);
  });

  it("throws ProviderNotConfigured from every client read", async () => {
    await expect(schwabProvider.client.getHouseholds(ctx)).rejects.toThrow(ProviderNotConfigured);
    await expect(schwabProvider.client.getAccounts(ctx, "hh")).rejects.toThrow(ProviderNotConfigured);
    await expect(schwabProvider.client.getPositions(ctx, "a")).rejects.toThrow(ProviderNotConfigured);
  });
});
