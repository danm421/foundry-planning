import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SignJWT, exportJWK, generateKeyPair } from "jose";

const webhookVerificationKeyGet = vi.fn();
vi.mock("../client", () => ({
  getPlaidClient: () => ({
    webhookVerificationKeyGet: (...a: unknown[]) => webhookVerificationKeyGet(...a),
  }),
}));

import { verifyPlaidWebhook, _clearKeyCacheForTests } from "../webhook-verify";

const BODY = JSON.stringify({ webhook_type: "ITEM", webhook_code: "ERROR", item_id: "plaid-item-1" });
const KID = "test-kid-1";

async function makeKeys() {
  const { publicKey, privateKey } = await generateKeyPair("ES256");
  const jwk = { ...(await exportJWK(publicKey)), kid: KID, alg: "ES256", use: "sig" };
  return { privateKey, jwk };
}

function bodyHash(body: string): string {
  return createHash("sha256").update(body).digest("hex");
}

async function signJwt(
  privateKey: CryptoKey,
  claims: Record<string, unknown>,
  header: Record<string, unknown> = { alg: "ES256", kid: KID },
) {
  let jwt = new SignJWT(claims).setProtectedHeader(header as never);
  if (!("iat" in claims)) jwt = jwt.setIssuedAt();
  return jwt.sign(privateKey);
}

beforeEach(() => {
  webhookVerificationKeyGet.mockReset();
  _clearKeyCacheForTests();
});

describe("verifyPlaidWebhook", () => {
  it("accepts a valid ES256 JWT with matching body hash", async () => {
    const { privateKey, jwk } = await makeKeys();
    webhookVerificationKeyGet.mockResolvedValue({ data: { key: { ...jwk, expired_at: null } } });
    const jwt = await signJwt(privateKey, { request_body_sha256: bodyHash(BODY) });
    expect(await verifyPlaidWebhook(BODY, jwt)).toEqual({ ok: true });
    expect(webhookVerificationKeyGet).toHaveBeenCalledWith({ key_id: KID });
  });

  it("caches the JWK by kid (one fetch for two verifications)", async () => {
    const { privateKey, jwk } = await makeKeys();
    webhookVerificationKeyGet.mockResolvedValue({ data: { key: { ...jwk, expired_at: null } } });
    const jwt = await signJwt(privateKey, { request_body_sha256: bodyHash(BODY) });
    await verifyPlaidWebhook(BODY, jwt);
    await verifyPlaidWebhook(BODY, jwt);
    expect(webhookVerificationKeyGet).toHaveBeenCalledTimes(1);
  });

  it("rejects a missing header", async () => {
    expect((await verifyPlaidWebhook(BODY, null)).ok).toBe(false);
    expect(webhookVerificationKeyGet).not.toHaveBeenCalled();
  });

  it("rejects a non-ES256 alg without fetching keys", async () => {
    // 'none'-alg style forgery: unsigned token with alg none is malformed for
    // jose sign, so hand-craft the compact form.
    const headerB64 = Buffer.from(JSON.stringify({ alg: "none", kid: KID })).toString("base64url");
    const payloadB64 = Buffer.from(JSON.stringify({ request_body_sha256: bodyHash(BODY), iat: 0 })).toString("base64url");
    const res = await verifyPlaidWebhook(BODY, `${headerB64}.${payloadB64}.`);
    expect(res.ok).toBe(false);
    expect(webhookVerificationKeyGet).not.toHaveBeenCalled();
  });

  it("rejects a body-hash mismatch", async () => {
    const { privateKey, jwk } = await makeKeys();
    webhookVerificationKeyGet.mockResolvedValue({ data: { key: { ...jwk, expired_at: null } } });
    const jwt = await signJwt(privateKey, { request_body_sha256: bodyHash("tampered") });
    expect((await verifyPlaidWebhook(BODY, jwt)).ok).toBe(false);
  });

  it("rejects a stale iat (older than 5 minutes)", async () => {
    const { privateKey, jwk } = await makeKeys();
    webhookVerificationKeyGet.mockResolvedValue({ data: { key: { ...jwk, expired_at: null } } });
    const staleIat = Math.floor(Date.now() / 1000) - 6 * 60;
    const jwt = await signJwt(privateKey, { request_body_sha256: bodyHash(BODY), iat: staleIat });
    expect((await verifyPlaidWebhook(BODY, jwt)).ok).toBe(false);
  });

  it("rejects an expired key and does not cache it", async () => {
    const { privateKey, jwk } = await makeKeys();
    webhookVerificationKeyGet.mockResolvedValue({ data: { key: { ...jwk, expired_at: 1700000000 } } });
    const jwt = await signJwt(privateKey, { request_body_sha256: bodyHash(BODY) });
    expect((await verifyPlaidWebhook(BODY, jwt)).ok).toBe(false);
    await verifyPlaidWebhook(BODY, jwt);
    expect(webhookVerificationKeyGet).toHaveBeenCalledTimes(2); // not cached
  });

  it("rejects a signature from a different key", async () => {
    const { jwk } = await makeKeys();
    const other = await generateKeyPair("ES256");
    webhookVerificationKeyGet.mockResolvedValue({ data: { key: { ...jwk, expired_at: null } } });
    const jwt = await signJwt(other.privateKey, { request_body_sha256: bodyHash(BODY) });
    expect((await verifyPlaidWebhook(BODY, jwt)).ok).toBe(false);
  });

  it("rejects a token missing kid", async () => {
    const { privateKey } = await makeKeys();
    const jwt = await signJwt(
      privateKey,
      { request_body_sha256: bodyHash(BODY) },
      { alg: "ES256" },
    );
    expect((await verifyPlaidWebhook(BODY, jwt)).ok).toBe(false);
    expect(webhookVerificationKeyGet).not.toHaveBeenCalled();
  });

  it("rejects a token missing request_body_sha256 claim", async () => {
    const { privateKey, jwk } = await makeKeys();
    webhookVerificationKeyGet.mockResolvedValue({ data: { key: { ...jwk, expired_at: null } } });
    const jwt = await signJwt(privateKey, {});
    expect((await verifyPlaidWebhook(BODY, jwt)).ok).toBe(false);
  });
});
