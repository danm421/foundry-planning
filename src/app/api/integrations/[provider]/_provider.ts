// src/app/api/integrations/[provider]/_provider.ts
import { getProvider, isProviderId } from "@/lib/integrations/registry";
import type { ProviderDefinition } from "@/lib/integrations/types";

/**
 * Resolves the dynamic [provider] segment. Returns null for both unknown ids
 * and known-but-disabled ones, so callers 404 identically in either case —
 * a disabled provider must not be distinguishable from a nonexistent one.
 *
 * The `isProviderId` gate is load-bearing: an unvalidated string must never
 * reach `getProvider` (which indexes the registry by a typed key).
 */
export async function resolveProvider(
  params: Promise<{ provider: string }>,
): Promise<ProviderDefinition | null> {
  const { provider } = await params;
  if (!isProviderId(provider)) return null;
  const def = getProvider(provider);
  return def.isEnabled() ? def : null;
}
