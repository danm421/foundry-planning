// src/lib/orion/auth.test.ts
import { describe, it, expect, beforeAll, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { upsertConnection, getConnection } from "./connections";
import { getValidAccessToken, OrionReconnectRequired, __setRefresher } from "./auth";

const firmId = `test_firm_${randomBytes(4).toString("hex")}`;
beforeAll(() => { process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString("base64"); });

describe("getValidAccessToken", () => {
  it("returns the stored token when unexpired", async () => {
    await upsertConnection({
      firmId, accessToken: "AT", refreshToken: "RT", userId: "u1",
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    expect(await getValidAccessToken(firmId)).toBe("AT");
  });

  it("refreshes when expired and persists rotated refresh token", async () => {
    await upsertConnection({
      firmId, accessToken: "OLD", refreshToken: "RT_OLD", userId: "u1",
      expiresAt: new Date(Date.now() - 1000),
    });
    __setRefresher(vi.fn().mockResolvedValue({ accessToken: "NEW", refreshToken: "RT_NEW", expiresInSec: 3600 }));
    expect(await getValidAccessToken(firmId)).toBe("NEW");
    expect((await getConnection(firmId))?.refreshToken).toBe("RT_NEW");
  });

  it("throws OrionReconnectRequired and flips status on refresh failure", async () => {
    await upsertConnection({
      firmId, accessToken: "OLD", refreshToken: "RT", userId: "u1",
      expiresAt: new Date(Date.now() - 1000),
    });
    __setRefresher(vi.fn().mockRejectedValue(new Error("revoked")));
    await expect(getValidAccessToken(firmId)).rejects.toBeInstanceOf(OrionReconnectRequired);
    expect((await getConnection(firmId))?.status).toBe("error");
  });
});
