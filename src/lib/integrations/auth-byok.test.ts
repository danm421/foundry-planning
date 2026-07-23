// src/lib/integrations/auth-byok.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./connections", () => ({ getConnection: vi.fn() }));
vi.mock("./registry", () => ({ getProvider: vi.fn() }));

import { getConnection } from "./connections";
import { getProvider } from "./registry";
import { encodeAddeparSecret, encodeAddeparConfig } from "./providers/addepar/credentials";
import { makeCallContext } from "./auth";
import type { ProviderId } from "./types";

// Addepar isn't registered in PROVIDER_IDS until a later task; this cast lets
// the BYOK branch be exercised now via a mocked registry + connection.
const ADDEPAR = "addepar" as ProviderId;

describe("makeCallContext for BYOK", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns the decrypted secret blob and never refreshes", async () => {
    const secret = { apiKey: "k", apiSecret: "s" };
    (getProvider as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      id: "addepar",
      authKind: "byok",
    });
    (getConnection as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      accessToken: encodeAddeparSecret(secret),
      scope: encodeAddeparConfig({ apiBase: "https://api.addepar.com", addeparFirmId: "42" }),
      status: "connected",
    });

    const ctx = await makeCallContext("firm_1", ADDEPAR);
    const token = await ctx.getToken({ forceRefresh: true });

    expect(JSON.parse(token)).toEqual(secret);
    expect(ctx.baseUrl).toBe("https://api.addepar.com");
    expect(ctx.config?.addeparFirmId).toBe("42");
  });
});
