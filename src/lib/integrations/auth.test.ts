// src/lib/integrations/auth.test.ts
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { integrationConnections } from "@/db/schema";
import { createByokConnection, loadConnection, upsertOauthConnection } from "./connections";
import { connectionCallContext, getConnectionAccessToken, __setRefresher } from "./auth";
import { ReconnectRequired } from "./errors";
import { encodeAddeparConfig, encodeAddeparSecret } from "./providers/addepar/credentials";

const firmIds: string[] = [];
function freshFirmId(): string {
  const id = `org_test_${randomUUID()}`;
  firmIds.push(id);
  return id;
}

function orion(input: { accessToken: string; refreshToken?: string; expiresAt: Date }) {
  return upsertOauthConnection({ firmId: freshFirmId(), providerId: "orion", ownerUserId: "u1", ...input });
}

const inAnHour = () => new Date(Date.now() + 3_600_000);
const aSecondAgo = () => new Date(Date.now() - 1000);

beforeAll(() => { process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString("base64"); });
afterEach(() => { __setRefresher(null); });
afterAll(async () => {
  if (firmIds.length === 0) return;
  await db.delete(integrationConnections).where(inArray(integrationConnections.firmId, firmIds));
});

describe("getConnectionAccessToken", () => {
  it("returns the stored token when unexpired", async () => {
    const id = await orion({ accessToken: "AT", refreshToken: "RT", expiresAt: inAnHour() });
    expect(await getConnectionAccessToken(id)).toBe("AT");
  });

  it("refreshes when expired, persists the rotated refresh token, and keeps the owner", async () => {
    const id = await orion({ accessToken: "OLD", refreshToken: "RT_OLD", expiresAt: aSecondAgo() });
    __setRefresher(vi.fn().mockResolvedValue({ accessToken: "NEW", refreshToken: "RT_NEW", expiresInSec: 3600 }));

    expect(await getConnectionAccessToken(id)).toBe("NEW");
    expect(await loadConnection(id)).toMatchObject({ accessToken: "NEW", refreshToken: "RT_NEW", ownerUserId: "u1" });
  });

  it("throws ReconnectRequired and flips status on refresh failure", async () => {
    const id = await orion({ accessToken: "OLD", refreshToken: "RT", expiresAt: aSecondAgo() });
    __setRefresher(vi.fn().mockRejectedValue(new Error("revoked")));

    await expect(getConnectionAccessToken(id)).rejects.toBeInstanceOf(ReconnectRequired);
    expect(await loadConnection(id)).toMatchObject({ status: "error", lastSyncError: "revoked" });
  });

  it("throws ReconnectRequired for an expired token with no refresh token", async () => {
    const id = await orion({ accessToken: "OLD", expiresAt: aSecondAgo() });
    await expect(getConnectionAccessToken(id)).rejects.toBeInstanceOf(ReconnectRequired);
  });

  it("force-refreshes even when the stored token is unexpired", async () => {
    const id = await orion({ accessToken: "STILL_GOOD", refreshToken: "RT", expiresAt: inAnHour() });
    __setRefresher(vi.fn().mockResolvedValue({ accessToken: "FORCED", refreshToken: "RT2", expiresInSec: 3600 }));
    expect(await getConnectionAccessToken(id, { forceRefresh: true })).toBe("FORCED");
  });
});

describe("connectionCallContext", () => {
  it("connectionCallContext carries the connection id, firm and Addepar config", async () => {
    const firmId = freshFirmId();
    const secret = { apiKey: "k", apiSecret: "s" };
    const config = { apiBase: "https://ethos.addepar.com", addeparFirmId: "1069" };
    const id = await createByokConnection({
      firmId, ownerUserId: "u1", name: "Ethos",
      secretBlob: encodeAddeparSecret(secret), configBlob: encodeAddeparConfig(config),
    });

    const ctx = await connectionCallContext(id);

    expect(ctx).toMatchObject({ connectionId: id, firmId, providerId: "addepar", config });
    expect(JSON.parse(await ctx.getToken())).toEqual(secret);
  });

  it("an OAuth context reads its token through the connection", async () => {
    const id = await orion({ accessToken: "AT", refreshToken: "RT", expiresAt: inAnHour() });
    const fetchImpl = vi.fn() as unknown as typeof fetch;

    const ctx = await connectionCallContext(id, { fetchImpl, baseUrl: "https://orion.test" });

    expect(ctx).toMatchObject({ connectionId: id, providerId: "orion", fetchImpl, baseUrl: "https://orion.test" });
    expect(await ctx.getToken()).toBe("AT");
  });
});
