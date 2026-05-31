import { db } from "@/db";
import { clients, entities } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import EntitiesCashFlowReportView from "@/components/entities-cashflow-report-view";

interface Props {
  id: string;
  firmId: string;
  scenarioParam?: string;
}

/** Map an account-business type to the report's entityType union. `sole_prop`
 *  has no entity equivalent — surfaced as `"other"` so it groups with the
 *  generic businesses bucket in the header dropdown. */
function mapAccountBusinessTypeToEntityType(
  businessType: string | null | undefined,
): string {
  switch (businessType) {
    case "llc":
    case "s_corp":
    case "c_corp":
    case "partnership":
      return businessType;
    case "sole_prop":
    case "other":
    case null:
    case undefined:
    default:
      return "other";
  }
}

export async function EntitiesCashFlowContent({ id, firmId, scenarioParam }: Props) {
  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));

  if (!client) {
    // page.tsx guards first; this is a belt-and-suspenders fallback in case
    // the content component is ever used outside that guard.
    notFound();
  }

  // Top-level business accounts are drawn from the effective (scenario-resolved)
  // tree so that businesses added via scenario overlay changes appear in the
  // picker. loadEffectiveTree defaults to the base case when scenarioParam is
  // undefined or "base".
  const [entityRows, { effectiveTree }] = await Promise.all([
    db.select().from(entities).where(eq(entities.clientId, id)),
    loadEffectiveTree(id, firmId, scenarioParam ?? "base", {}),
  ]);

  // Top-level business accounts on the effective scenario surface as
  // "Businesses" alongside legacy entity-modeled businesses. Children
  // (parentAccountId != null) are NOT included — only the top-level entry.
  const businessAccountRows = (effectiveTree.accounts ?? [])
    .filter((a) => a.category === "business" && !a.parentAccountId)
    .map((a) => ({ id: a.id, name: a.name, businessType: a.businessType ?? null }));

  const entityInfos = [
    ...entityRows.map((e) => ({
      id: e.id,
      name: e.name,
      entityType: e.entityType,
    })),
    ...businessAccountRows.map((a) => ({
      id: a.id,
      name: a.name,
      entityType: mapAccountBusinessTypeToEntityType(a.businessType),
    })),
  ];

  return (
    <EntitiesCashFlowReportView
      clientId={id}
      entities={entityInfos}
    />
  );
}
