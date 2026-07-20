// src/lib/integrations/providers/orion/client.test.ts
import { describe, it, expect, vi } from "vitest";
import { orionClient } from "./client";
import type { ProviderCallContext } from "../../types";

vi.mock("@/lib/rate-limit", () => ({
  checkIntegrationApiLimit: vi.fn().mockResolvedValue({ allowed: true }),
}));

function jsonRes(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body, headers: new Headers() };
}

/** Build a call context whose getToken records the opts it was handed. */
function makeCtx(
  fetchImpl: ReturnType<typeof vi.fn>,
  getToken: ReturnType<typeof vi.fn>,
): ProviderCallContext {
  return {
    firmId: "firm_1",
    providerId: "orion",
    getToken: getToken as unknown as ProviderCallContext["getToken"],
    fetchImpl: fetchImpl as unknown as typeof fetch,
    baseUrl: "https://api.orion.test",
  };
}

describe("orionClient", () => {
  it("validates and returns accounts, sending a bearer token", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonRes([{ id: "a1", name: "Joint", registrationType: "Joint" }]));
    const getToken = vi.fn().mockResolvedValue("AT");
    const accounts = await orionClient.getAccounts(makeCtx(fetchImpl, getToken), "hh1");
    expect(accounts[0].id).toBe("a1");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const headers = (fetchImpl.mock.calls[0][1] as any).headers;
    expect(headers.Authorization ?? headers.authorization).toBe("Bearer AT");
  });

  it("throws on malformed payloads", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonRes([{ wrong: true }]));
    const getToken = vi.fn().mockResolvedValue("AT");
    await expect(orionClient.getAccounts(makeCtx(fetchImpl, getToken), "hh1")).rejects.toThrow();
  });

  it("forces a token refresh and retries once on 401", async () => {
    const getToken = vi.fn().mockResolvedValueOnce("AT").mockResolvedValueOnce("AT2");
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonRes([], 401))
      .mockResolvedValueOnce(jsonRes([{ id: "a1", name: "Joint" }]));
    const accounts = await orionClient.getAccounts(makeCtx(fetchImpl, getToken), "hh1");
    expect(accounts[0].id).toBe("a1");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    // first call: normal (no force); retry: forced refresh
    expect(getToken.mock.calls[0][0]).toEqual({ forceRefresh: false });
    expect(getToken.mock.calls[1][0]).toEqual({ forceRefresh: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const retryHeaders = (fetchImpl.mock.calls[1][1] as any).headers;
    expect(retryHeaders.Authorization ?? retryHeaders.authorization).toBe("Bearer AT2");
  });
});
