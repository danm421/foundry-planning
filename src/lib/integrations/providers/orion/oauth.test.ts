// src/lib/integrations/providers/orion/oauth.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { createHash } from "node:crypto";
import { generatePkce, generateState, buildAuthorizeUrl, exchangeCodeForTokens } from "./oauth";

describe("orion oauth helpers", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("PKCE challenge is base64url(sha256(verifier))", () => {
    const { verifier, challenge } = generatePkce();
    const expected = createHash("sha256").update(verifier).digest("base64url");
    expect(challenge).toBe(expected);
  });

  it("authorize URL carries S256 challenge, state, redirect", () => {
    vi.stubEnv("ORION_CLIENT_ID", "cid");
    vi.stubEnv("ORION_REDIRECT_URI", "https://app.test/api/integrations/orion/callback");
    vi.stubEnv("ORION_API_BASE", "https://api.orion.test");
    const url = new URL(buildAuthorizeUrl({ state: "st", challenge: "ch" }));
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe("st");
    expect(url.searchParams.get("client_id")).toBe("cid");
  });

  it("exchangeCodeForTokens normalizes the token response", async () => {
    vi.stubEnv("ORION_CLIENT_ID", "cid");
    vi.stubEnv("ORION_CLIENT_SECRET", "cs");
    vi.stubEnv("ORION_REDIRECT_URI", "https://app.test/api/integrations/orion/callback");
    vi.stubEnv("ORION_API_BASE", "https://api.orion.test");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: "AT", refresh_token: "RT", expires_in: 3600, scope: "read" }),
    });
    const res = await exchangeCodeForTokens({ code: "c", codeVerifier: "v" }, fetchMock as unknown as typeof fetch);
    expect(res).toEqual({ accessToken: "AT", refreshToken: "RT", expiresInSec: 3600, scope: "read" });
  });

  it("generateState is unguessable-ish (>=32 chars, unique)", () => {
    expect(generateState().length).toBeGreaterThanOrEqual(32);
    expect(generateState()).not.toBe(generateState());
  });
});
