// src/lib/integrations/providers/addepar/flag.ts

/**
 * Addepar kill-switch. Mirrors the inline `process.env.X === "..."` flag pattern
 * Foundry already uses (src/domain/forge/flag.ts, src/lib/integrations/providers/schwab/flag.ts).
 * Strict equality on "true" — no truthy coercion — so a stray "1"/"yes"/"" never
 * silently enables it.
 *
 * OFF everywhere until a firm connects Addepar BYOK credentials.
 */
export function isAddeparEnabled(): boolean {
  return process.env.ADDEPAR_ENABLED === "true";
}
