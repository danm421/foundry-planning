import { createHash, timingSafeEqual } from "node:crypto";
import { decodeProtectedHeader, importJWK, jwtVerify, type JWK } from "jose";
import { getPlaidClient } from "./client";

/**
 * Plaid signs each webhook with an ES256 JWT in the Plaid-Verification
 * header; the JWT's request_body_sha256 claim covers the raw body. Docs:
 * https://plaid.com/docs/api/webhooks/webhook-verification/
 */
export type PlaidWebhookVerification = { ok: true } | { ok: false; reason: string };

// Module-level JWK cache by kid. Keys rotate rarely; a cold fetch is one
// Plaid call. Expired keys are rejected and never cached.
const keyCache = new Map<string, JWK>();

/** Test hook — the cache is module state and vitest reuses module instances. */
export function _clearKeyCacheForTests(): void {
  keyCache.clear();
}

const MAX_TOKEN_AGE = "5 minutes"; // replay guard, enforced on iat

async function getVerificationKey(kid: string): Promise<JWK | null> {
  const cached = keyCache.get(kid);
  if (cached) return cached;
  const resp = await getPlaidClient().webhookVerificationKeyGet({ key_id: kid });
  const key = resp.data.key as unknown as JWK & { expired_at: number | null };
  if (key.expired_at != null) return null;
  keyCache.set(kid, key);
  return key;
}

export async function verifyPlaidWebhook(
  rawBody: string,
  verificationJwt: string | null,
): Promise<PlaidWebhookVerification> {
  if (!verificationJwt) return { ok: false, reason: "missing Plaid-Verification header" };

  let kid: string;
  try {
    const header = decodeProtectedHeader(verificationJwt);
    if (header.alg !== "ES256") return { ok: false, reason: `unexpected alg ${String(header.alg)}` };
    if (typeof header.kid !== "string") return { ok: false, reason: "missing kid" };
    kid = header.kid;
  } catch {
    return { ok: false, reason: "malformed JWT" };
  }

  let jwk: JWK | null;
  try {
    jwk = await getVerificationKey(kid);
  } catch {
    return { ok: false, reason: "verification key fetch failed" };
  }
  if (!jwk) return { ok: false, reason: "unknown or expired verification key" };

  try {
    const key = await importJWK(jwk, "ES256");
    const { payload } = await jwtVerify(verificationJwt, key, {
      algorithms: ["ES256"],
      maxTokenAge: MAX_TOKEN_AGE,
    });
    const claimed = payload.request_body_sha256;
    if (typeof claimed !== "string") return { ok: false, reason: "missing request_body_sha256 claim" };
    const actual = createHash("sha256").update(rawBody).digest("hex");
    const a = Buffer.from(actual);
    const b = Buffer.from(claimed);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return { ok: false, reason: "request body hash mismatch" };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: "JWT verification failed" };
  }
}
