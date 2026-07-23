// src/lib/integrations/providers/addepar/client.test.ts
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/rate-limit", () => ({
  checkIntegrationApiLimit: vi.fn().mockResolvedValue({ allowed: true }),
}));

import { addeparClient } from "./client";
import { encodeAddeparSecret } from "./credentials";
import type { ProviderCallContext, ProviderId } from "../../types";

// Addepar isn't registered in PROVIDER_IDS until a later task; this cast lets
// the client be exercised now via a context that satisfies ProviderCallContext.
const ADDEPAR = "addepar" as ProviderId;

function ctxWith(fetchImpl: typeof fetch): ProviderCallContext {
  return {
    providerId: ADDEPAR,
    firmId: "firm_1",
    baseUrl: "https://api.addepar.com",
    config: { apiBase: "https://api.addepar.com", addeparFirmId: "42" },
    getToken: async () => encodeAddeparSecret({ apiKey: "k", apiSecret: "s" }),
    fetchImpl,
  };
}

describe("addepar client", () => {
  it("uses HTTP Basic auth from the credential blob", async () => {
    const seen: Record<string, string> = {};
    const fake = vi.fn(async (_url: string, init?: RequestInit) => {
      seen.auth = new Headers(init?.headers).get("authorization") ?? "";
      return new Response(JSON.stringify({ households: [{ id: "h1", name: "Doe Family" }] }), {
        status: 200,
      });
    }) as unknown as typeof fetch;

    const rows = await addeparClient.getHouseholds(ctxWith(fake));

    expect(rows).toEqual([{ id: "h1", name: "Doe Family" }]);
    expect(seen.auth).toBe(`Basic ${Buffer.from("k:s").toString("base64")}`);
  });

  it("retries once on 401 then succeeds", async () => {
    let n = 0;
    const fake = vi.fn(async () => {
      n += 1;
      return n === 1
        ? new Response("nope", { status: 401 })
        : new Response(JSON.stringify({ households: [] }), { status: 200 });
    }) as unknown as typeof fetch;

    await addeparClient.getHouseholds(ctxWith(fake));

    expect(n).toBe(2);
  });
});
