import { eq } from "drizzle-orm";
import { db } from "@/db";
import { firms } from "@/db/schema";

export type BrandingRow = {
  logoUrl: string | null;
  faviconUrl: string | null;
  primaryColor: string | null;
};

export async function getBranding(firmId: string): Promise<BrandingRow | null> {
  const row = await db.query.firms.findFirst({
    where: eq(firms.firmId, firmId),
    columns: { logoUrl: true, faviconUrl: true, primaryColor: true },
  });
  return row ?? null;
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
