// src/lib/integrations/providers/schwab/flag.ts

/**
 * Schwab kill-switch. Mirrors the inline `process.env.X === "..."` flag pattern
 * Foundry already uses (src/domain/forge/flag.ts, BILLING_ENFORCEMENT_MODE in
 * src/proxy.ts). Strict equality on "true" — no truthy coercion — so a stray
 * "1"/"yes"/"" never silently enables it.
 *
 * OFF everywhere including prod until Schwab partner credentials land and the
 * transport in ./client.ts and ./oauth.ts is implemented against the real API.
 */
export function isSchwabEnabled(): boolean {
  return process.env.SCHWAB_ENABLED === "true";
}
