// src/lib/integrations/auth-byok.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./connections", () => ({ loadConnection: vi.fn() }));
vi.mock("./registry", () => ({ getProvider: vi.fn() }));

import { loadConnection } from "./connections";
import { getProvider } from "./registry";
import { encodeAddeparSecret, encodeAddeparConfig } from "./providers/addepar/credentials";
import { connectionCallContext } from "./auth";

describe("connectionCallContext for BYOK", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns the decrypted secret blob and never refreshes", async () => {
    const secret = { apiKey: "k", apiSecret: "s" };
    (getProvider as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      id: "addepar",
      authKind: "byok",
    });
    (loadConnection as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "conn_1",
      firmId: "firm_1",
      providerId: "addepar",
      accessToken: encodeAddeparSecret(secret),
      scope: encodeAddeparConfig({ apiBase: "https://api.addepar.com", addeparFirmId: "42" }),
      status: "connected",
    });

    const ctx = await connectionCallContext("conn_1");
    const token = await ctx.getToken({ forceRefresh: true });

    expect(JSON.parse(token)).toEqual(secret);
    expect(ctx.config).toEqual({ apiBase: "https://api.addepar.com", addeparFirmId: "42" });
    expect(ctx).toMatchObject({ connectionId: "conn_1", firmId: "firm_1", providerId: "addepar" });
    // The static key is read once, when the context is built.
    expect(loadConnection).toHaveBeenCalledTimes(1);
  });
});
