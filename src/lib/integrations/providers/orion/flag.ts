// src/lib/integrations/providers/orion/flag.ts

/**
 * Orion kill-switch. Mirrors the inline `process.env.X === "..."` flag pattern
 * Foundry already uses (src/lib/integrations/providers/schwab/flag.ts,
 * src/lib/integrations/providers/addepar/flag.ts). Strict equality on "true" —
 * no truthy coercion — so a stray "1"/"yes"/"" never silently enables it.
 *
 * OFF everywhere including prod until Orion partner credentials land and the
 * integration is activated. The OAuth transport in ./oauth.ts is implemented,
 * so flipping ORION_ENABLED=true is all that's needed to turn it back on.
 */
export function isOrionEnabled(): boolean {
  return process.env.ORION_ENABLED === "true";
}
