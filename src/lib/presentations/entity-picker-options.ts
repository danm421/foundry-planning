// Server-side: the trust/business universe for the presentations builder's
// "Business & Trusts" page picker. Mirrors entities-cashflow-content.tsx:
// entity rows + top-level (parentless) business accounts on the base tree.
import { db } from "@/db";
import { entities } from "@/db/schema";
import { eq } from "drizzle-orm";
import { loadEffectiveTree } from "@/lib/scenario/loader";

export interface EntityPickerOption {
  id: string;
  name: string;
  /** "trust" | "llc" | "s_corp" | "c_corp" | "partnership" | "foundation" | "other" */
  entityType: string;
}

/** Map an account business type to the report's entityType union. `sole_prop`
 *  has no entity equivalent — surfaced as "other" so it groups with the generic
 *  businesses bucket. */
export function mapAccountBusinessTypeToEntityType(
  businessType: string | null | undefined,
): string {
  switch (businessType) {
    case "llc":
    case "s_corp":
    case "c_corp":
    case "partnership":
      return businessType;
    default:
      return "other";
  }
}

export async function loadEntityPickerOptions(
  clientId: string,
  firmId: string,
): Promise<EntityPickerOption[]> {
  const [entityRows, { effectiveTree }] = await Promise.all([
    db.select().from(entities).where(eq(entities.clientId, clientId)),
    loadEffectiveTree(clientId, firmId, "base", {}),
  ]);

  const businessAccountRows = (effectiveTree.accounts ?? [])
    .filter((a) => a.category === "business" && !a.parentAccountId)
    .map((a) => ({ id: a.id, name: a.name, businessType: a.businessType ?? null }));

  return [
    ...entityRows.map((e) => ({ id: e.id, name: e.name, entityType: e.entityType as string })),
    ...businessAccountRows.map((a) => ({
      id: a.id,
      name: a.name,
      entityType: mapAccountBusinessTypeToEntityType(a.businessType),
    })),
  ];
}
