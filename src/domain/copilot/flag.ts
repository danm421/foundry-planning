// src/domain/copilot/flag.ts

/**
 * Single source of truth for the copilot feature flag. Mirrors the inline
 * `process.env.X === "..."` flag pattern Foundry already uses (e.g.
 * BILLING_ENFORCEMENT_MODE in src/proxy.ts). The copilot stream/resume
 * routes 404 when this returns false. Strict equality on "true" — no truthy
 * coercion — so a stray "1"/"yes"/"" never silently enables it.
 */
export function isCopilotEnabled(): boolean {
  return process.env.COPILOT_ENABLED === "true";
}
