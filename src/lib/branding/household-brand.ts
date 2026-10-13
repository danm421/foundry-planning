import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { FIRM_BRAND, householdBrand, type BrandChoice } from "./brand-choice";

/**
 * A household's brand by id, for callers that hold no client row (the preview
 * route, the public intake page). Scoped by client AND firm; a missing row is
 * the firm brand, since branding must never be what fails a page.
 */
export async function loadHouseholdBrand(clientId: string, firmId: string): Promise<BrandChoice> {
  const [row] = await db
    .select({ advisorId: clients.advisorId, brand: clients.brand })
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.firmId, firmId)));
  return row ? householdBrand(row) : FIRM_BRAND;
}
