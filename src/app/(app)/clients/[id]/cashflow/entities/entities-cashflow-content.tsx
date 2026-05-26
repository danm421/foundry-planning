import { db } from "@/db";
import { accounts as accountsTable, clients, entities, scenarios } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { notFound } from "next/navigation";
import EntitiesCashFlowReportView from "@/components/entities-cashflow-report-view";

interface Props {
  id: string;
  firmId: string;
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

export async function EntitiesCashFlowContent({ id, firmId }: Props) {
  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));

  if (!client) {
    // page.tsx guards first; this is a belt-and-suspenders fallback in case
    // the content component is ever used outside that guard.
    notFound();
  }

  const [entityRows, baseScenarioRow] = await Promise.all([
    db.select().from(entities).where(eq(entities.clientId, id)),
    db
      .select({ id: scenarios.id })
      .from(scenarios)
      .where(and(eq(scenarios.clientId, id), eq(scenarios.isBaseCase, true)))
      .limit(1),
  ]);

  // Top-level business accounts on the base scenario surface as
  // "Businesses" alongside legacy entity-modeled businesses. Children
  // (parentAccountId != null) are NOT included — only the top-level entry.
  const baseScenarioId = baseScenarioRow[0]?.id;
  const businessAccountRows = baseScenarioId
    ? await db
        .select({
          id: accountsTable.id,
          name: accountsTable.name,
          businessType: accountsTable.businessType,
        })
        .from(accountsTable)
        .where(
          and(
            eq(accountsTable.clientId, id),
            eq(accountsTable.scenarioId, baseScenarioId),
            eq(accountsTable.category, "business"),
            isNull(accountsTable.parentAccountId),
          ),
        )
    : [];

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
