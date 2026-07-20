// src/lib/integrations/connections.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { randomBytes } from "node:crypto";
import {
  upsertConnection, getConnection, disconnectConnection,
  createOauthState, consumeOauthState,
} from "./connections";

const firmId = `test_firm_${randomBytes(4).toString("hex")}`;

beforeAll(() => {
  process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString("base64");
});

describe("integrations connections", () => {
  it("stores tokens encrypted and reads them back decrypted", async () => {
    await upsertConnection({ firmId, providerId: "orion", accessToken: "AT", refreshToken: "RT", userId: "u1" });
    const conn = await getConnection(firmId, "orion");
    expect(conn?.status).toBe("connected");
    expect(conn?.accessToken).toBe("AT");          // helper decrypts
    expect(conn?.accessTokenEnc).not.toContain("AT"); // raw column is ciphertext
  });

  it("disconnect nulls tokens and flips status", async () => {
    await disconnectConnection(firmId, "orion");
    const conn = await getConnection(firmId, "orion");
    expect(conn?.status).toBe("disconnected");
    expect(conn?.refreshToken).toBeNull();
    expect(conn?.accessToken).toBeNull();
  });

  it("oauth state is single-use", async () => {
    await createOauthState({ firmId, providerId: "orion", userId: "u1", state: "s1", codeVerifier: "v1", ttlMs: 60000 });
    expect((await consumeOauthState("s1"))?.firmId).toBe(firmId);
    expect(await consumeOauthState("s1")).toBeNull(); // consumed
  });

  it("expired state returns null", async () => {
    await createOauthState({ firmId, providerId: "orion", userId: "u1", state: "s2", codeVerifier: "v2", ttlMs: -1 });
    expect(await consumeOauthState("s2")).toBeNull();
  });

  it("scopes connections by provider", async () => {
    await upsertConnection({
      firmId: "firm_1", providerId: "orion",
      accessToken: "tok-orion", userId: "u1",
    });
    await upsertConnection({
      firmId: "firm_1", providerId: "schwab",
      accessToken: "tok-schwab", userId: "u1",
    });

    expect((await getConnection("firm_1", "orion"))?.accessToken).toBe("tok-orion");
    expect((await getConnection("firm_1", "schwab"))?.accessToken).toBe("tok-schwab");
  });

  it("binds provider into the oauth state and returns it on consume", async () => {
    await createOauthState({
      firmId: "firm_1", providerId: "schwab", userId: "u1",
      state: "st-1", codeVerifier: "cv-1", ttlMs: 600_000,
    });
    const consumed = await consumeOauthState("st-1");
    expect(consumed).toMatchObject({ firmId: "firm_1", providerId: "schwab", userId: "u1" });
  });
});
