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
