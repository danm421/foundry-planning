// src/lib/integrations/auth.test.ts
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { upsertConnection, getConnection } from "./connections";
import { getValidAccessToken, makeCallContext, __setRefresher } from "./auth";
import { ReconnectRequired } from "./errors";

const firmId = `test_firm_${randomBytes(4).toString("hex")}`;
beforeAll(() => { process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString("base64"); });
afterEach(() => { __setRefresher(null); });

describe("getValidAccessToken", () => {
  it("returns the stored token when unexpired", async () => {
    await upsertConnection({
      firmId, providerId: "orion", accessToken: "AT", refreshToken: "RT", userId: "u1",
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    expect(await getValidAccessToken(firmId, "orion")).toBe("AT");
  });

  it("refreshes when expired and persists rotated refresh token", async () => {
    await upsertConnection({
      firmId, providerId: "orion", accessToken: "OLD", refreshToken: "RT_OLD", userId: "u1",
      expiresAt: new Date(Date.now() - 1000),
    });
    __setRefresher(vi.fn().mockResolvedValue({ accessToken: "NEW", refreshToken: "RT_NEW", expiresInSec: 3600 }));
    expect(await getValidAccessToken(firmId, "orion")).toBe("NEW");
    expect((await getConnection(firmId, "orion"))?.refreshToken).toBe("RT_NEW");
  });

  it("throws ReconnectRequired and flips status on refresh failure", async () => {
    await upsertConnection({
      firmId, providerId: "orion", accessToken: "OLD", refreshToken: "RT", userId: "u1",
      expiresAt: new Date(Date.now() - 1000),
    });
    __setRefresher(vi.fn().mockRejectedValue(new Error("revoked")));
    await expect(getValidAccessToken(firmId, "orion")).rejects.toBeInstanceOf(ReconnectRequired);
    expect((await getConnection(firmId, "orion"))?.status).toBe("error");
  });

  it("force-refreshes even when the stored token is unexpired", async () => {
    await upsertConnection({
      firmId, providerId: "orion", accessToken: "STILL_GOOD", refreshToken: "RT", userId: "u1",
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    __setRefresher(vi.fn().mockResolvedValue({ accessToken: "FORCED", refreshToken: "RT2", expiresInSec: 3600 }));
    expect(await getValidAccessToken(firmId, "orion", { forceRefresh: true })).toBe("FORCED");
  });

  it("makeCallContext binds firmId and providerId into the token getter", async () => {
    await upsertConnection({
      firmId, providerId: "orion", accessToken: "AT", refreshToken: "RT", userId: "u1",
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    __setRefresher(async () => ({ accessToken: "refreshed" }));
    const ctx = await makeCallContext(firmId, "orion");
    expect(ctx.firmId).toBe(firmId);
    expect(ctx.providerId).toBe("orion");
    await expect(ctx.getToken()).resolves.toBeTypeOf("string");
  });
});
