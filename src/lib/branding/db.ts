import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { firms } from "@/db/schema";

export type BrandingRow = {
  logoUrl: string | null;
  faviconUrl: string | null;
  primaryColor: string | null;
  displayName: string | null;
};

export async function getBranding(firmId: string): Promise<BrandingRow | null> {
  const row = await db.query.firms.findFirst({
    where: eq(firms.firmId, firmId),
    columns: { logoUrl: true, faviconUrl: true, primaryColor: true, displayName: true },
  });
  return row ?? null;
}

/**
 * The cached `display_name` for a SET of firms, in one query — the `getBranding`
 * fallback name, without the logo/colour columns a caller that only wants names
 * would never read.
 *
 * A firm with no `display_name` (it never filled in Firm settings) is ABSENT
 * from the map, not present with an empty string, so callers choose their own
 * fallback rather than rendering a blank where a name belongs.
 */
export async function getFirmDisplayNames(
  firmIds: readonly string[],
): Promise<Map<string, string>> {
  const ids = [...new Set(firmIds)];
  if (ids.length === 0) return new Map();

  const rows = await db
    .select({ firmId: firms.firmId, displayName: firms.displayName })
    .from(firms)
    .where(inArray(firms.firmId, ids));

  const names = new Map<string, string>();
  for (const row of rows) {
    if (row.displayName) names.set(row.firmId, row.displayName);
  }
  return names;
}

export async function setLogoUrl(firmId: string, url: string | null): Promise<void> {
  await db
    .update(firms)
    .set({ logoUrl: url, updatedAt: new Date() })
    .where(eq(firms.firmId, firmId));
}

export async function setFaviconUrl(firmId: string, url: string | null): Promise<void> {
  await db
    .update(firms)
    .set({ faviconUrl: url, updatedAt: new Date() })
    .where(eq(firms.firmId, firmId));
}

export async function setPrimaryColor(
  firmId: string,
  color: string | null,
): Promise<void> {
  await db
    .update(firms)
    .set({ primaryColor: color, updatedAt: new Date() })
    .where(eq(firms.firmId, firmId));
}
