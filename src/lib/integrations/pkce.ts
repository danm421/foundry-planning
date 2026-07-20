// src/lib/integrations/pkce.ts
import { createHash, randomBytes } from "node:crypto";

/**
 * Provider-agnostic OAuth PKCE + CSRF-state helpers. Standard RFC 7636 S256
 * (SHA-256 code challenge) plus a random opaque state — neither needs any
 * provider env, so every provider's connect route shares them rather than
 * reaching into one provider's package.
 */
export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function generateState(): string {
  return randomBytes(24).toString("base64url");
}
