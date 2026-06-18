// src/domain/forge/flag.ts

/**
 * Single source of truth for the forge feature flag. Mirrors the inline
 * `process.env.X === "..."` flag pattern Foundry already uses (e.g.
 * BILLING_ENFORCEMENT_MODE in src/proxy.ts). The forge stream/resume
 * routes 404 when this returns false. Strict equality on "true" — no truthy
 * coercion — so a stray "1"/"yes"/"" never silently enables it.
 *
 * Dual-read transition: prefers FORGE_ENABLED, falls back to the legacy
 * COPILOT_ENABLED so the flag never goes dark during the rename. The
 * COPILOT_ENABLED fallback is dropped once FORGE_ENABLED is live in Vercel.
 */
export function isForgeEnabled(): boolean {
  return (process.env.FORGE_ENABLED ?? process.env.COPILOT_ENABLED) === "true";
}

/**
 * Whether an org's entitlements grant Forge access. Dual-read transition: accepts
 * the new `ai_forge` key and the legacy `ai_copilot` (both seat-included today).
 * Drop the `ai_copilot` clause once every org's Clerk metadata carries `ai_forge`
 * (backfill + reconcile cron) — single edit point for both route gates.
 */
export function hasForgeEntitlement(entitlements: string[] | null | undefined): boolean {
  return !!entitlements && (entitlements.includes("ai_forge") || entitlements.includes("ai_copilot"));
}
