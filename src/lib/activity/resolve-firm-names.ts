import { clerkClient } from "@clerk/nextjs/server";

/**
 * Resolves a list of Clerk organization IDs to their display names.
 * Returns a Map containing only the firms that resolved successfully —
 * callers apply their own `?? "Unknown firm"` fallback.
 */
export async function resolveFirmNames(firmIds: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(firmIds)];
  const result = new Map<string, string>();
  if (unique.length === 0) return result;

  try {
    const cc = await clerkClient();
    await Promise.all(
      unique.map(async (id) => {
        try {
          const org = await cc.organizations.getOrganization({ organizationId: id });
          result.set(id, org.name);
        } catch {
          // Org not found or no longer accessible — silently skip.
        }
      }),
    );
  } catch (err) {
    console.error("[activity] clerk org lookup failed:", err);
  }

  return result;
}

/**
 * Resolves a single Clerk organization ID to its display name (the firm name
 * the advisor edits in Firm settings / Clerk's Organization Profile widget).
 * Returns undefined when Clerk is unreachable or the org has no name, so callers
 * apply their own fallback.
 */
export async function resolveFirmName(firmId: string): Promise<string | undefined> {
  return (await resolveFirmNames([firmId])).get(firmId)?.trim() || undefined;
}
