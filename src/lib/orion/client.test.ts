// src/lib/orion/client.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { OrionClient } from "./client";
import { getValidAccessToken } from "./auth";

vi.mock("./auth", () => ({ getValidAccessToken: vi.fn().mockResolvedValue("AT") }));
vi.mock("@/lib/rate-limit", () => ({ checkOrionApiLimit: vi.fn().mockResolvedValue({ allowed: true }) }));

function jsonRes(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body, headers: new Headers() };
}

describe("OrionClient", () => {
  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (getValidAccessToken as any).mockReset();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (getValidAccessToken as any).mockResolvedValue("AT");
  });

  it("validates and returns accounts, sending a bearer token", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonRes([{ id: "a1", name: "Joint", registrationType: "Joint" }]));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = new OrionClient({ firmId: "firm_1", fetchImpl: fetchImpl as any, baseUrl: "https://api.orion.test" });
    const accounts = await client.getAccounts("hh1");
    expect(accounts[0].id).toBe("a1");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const headers = (fetchImpl.mock.calls[0][1] as any).headers;
    expect(headers.Authorization ?? headers.authorization).toBe("Bearer AT");
  });

  it("throws on malformed payloads", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonRes([{ wrong: true }]));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = new OrionClient({ firmId: "firm_1", fetchImpl: fetchImpl as any, baseUrl: "https://api.orion.test" });
    await expect(client.getAccounts("hh1")).rejects.toThrow();
  });

  it("forces a token refresh and retries once on 401", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (getValidAccessToken as any).mockReset();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (getValidAccessToken as any).mockResolvedValueOnce("AT").mockResolvedValueOnce("AT2");
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonRes([], 401))
      .mockResolvedValueOnce(jsonRes([{ id: "a1", name: "Joint" }]));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = new OrionClient({ firmId: "firm_1", fetchImpl: fetchImpl as any, baseUrl: "https://api.orion.test" });
    const accounts = await client.getAccounts("hh1");
    expect(accounts[0].id).toBe("a1");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    // first call: normal (no force); retry: forced refresh
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((getValidAccessToken as any).mock.calls[0][1]).toEqual({ forceRefresh: false });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((getValidAccessToken as any).mock.calls[1][1]).toEqual({ forceRefresh: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const retryHeaders = (fetchImpl.mock.calls[1][1] as any).headers;
    expect(retryHeaders.Authorization ?? retryHeaders.authorization).toBe("Bearer AT2");
  });
});
