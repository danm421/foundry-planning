import { AI_IMPORT_FREE_QUOTA } from "@/lib/billing/entitlements";

/**
 * Pure gate for the billable AI-extract path (finding #7). A firm may run an
 * extraction when it either holds the paid `ai_import` entitlement OR still
 * has free-quota headroom (`aiImportsUsed < AI_IMPORT_FREE_QUOTA`). Mirrors
 * the OR-in in `deriveEntitlements`, but evaluated at extract-time intent so
 * updating-mode imports (which never hit the onboarding-commit credit path)
 * are also metered against the same ceiling.
 */
export function canExtract(input: {
  entitlements: string[] | undefined;
  aiImportsUsed: number;
}): boolean {
  if (input.entitlements?.includes("ai_import")) return true;
  return input.aiImportsUsed < AI_IMPORT_FREE_QUOTA;
}
