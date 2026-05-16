import { db } from "@/db";
import {
  clients,
  scenarios as scenariosTable,
  gifts,
  giftSeries,
} from "@/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { notFound } from "next/navigation";
import { requireOrgId } from "@/lib/db-helpers";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import {
  giftRowToDraft,
  giftSeriesRowToDraft,
  type EstateFlowGift,
} from "@/lib/estate/estate-flow-gifts";
import EstateFlowView from "@/components/estate-flow-view";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ scenario?: string }>;
}

export default async function EstateFlowPage({ params, searchParams }: PageProps) {
  const firmId = await requireOrgId();
  const { id } = await params;
  const sp = await searchParams;

  const [client] = await db
    .select({
      filingStatus: clients.filingStatus,
      firstName: clients.firstName,
      spouseName: clients.spouseName,
    })
    .from(clients)
    .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));
  if (!client) notFound();

  const scenarioId = sp.scenario ?? "base";

  // gift_series is scenario-scoped, so resolve the concrete scenario UUID first.
  // Mirrors load-client-data.ts / loadEffectiveTree: "base" → the client's
  // base-case scenario row; otherwise the searchParams UUID, firm-scoped via
  // the join on clients. `gifts` is client-scoped and needs no resolved
  // scenario, so it loads in parallel here; `gift_series` waits below.
  const [effectiveResult, scenarioRows, giftRows] = await Promise.all([
    loadEffectiveTree(id, firmId, scenarioId, {}).catch(() => notFound()),
    db
      .select({
        id: scenariosTable.id,
        name: scenariosTable.name,
        isBaseCase: scenariosTable.isBaseCase,
      })
      .from(scenariosTable)
      .innerJoin(clients, eq(clients.id, scenariosTable.clientId))
      .where(and(eq(scenariosTable.clientId, id), eq(clients.firmId, firmId))),
    db
      .select()
      .from(gifts)
      .where(eq(gifts.clientId, id))
      .orderBy(asc(gifts.year), asc(gifts.createdAt)),
  ]);
  const { effectiveTree } = effectiveResult;

  const resolvedScenario =
    scenarioId === "base"
      ? scenarioRows.find((s) => s.isBaseCase)
      : scenarioRows.find((s) => s.id === scenarioId);
  if (!resolvedScenario) notFound();

  // Editable recurring gift rows — `gift_series` is scenario-scoped, so this
  // query needs the resolved scenario UUID. Mirrors load-client-data.ts.
  const giftSeriesRows = await db
    .select()
    .from(giftSeries)
    .where(
      and(
        eq(giftSeries.clientId, id),
        eq(giftSeries.scenarioId, resolvedScenario.id),
      ),
    );

  const initialGifts: EstateFlowGift[] = [
    ...giftRows
      .map(giftRowToDraft)
      .filter((g): g is EstateFlowGift => g !== null),
    // gift_series.grantor uses the wider owner enum ("client" | "spouse" |
    // "joint") in the DB schema, but recurring gift series are constrained to
    // "client" | "spouse" by giftSeriesSchema / saveGiftRecurring — "joint" is
    // never stored. GiftSeriesDbRow.grantor reflects the narrower type, so cast
    // only that field rather than the whole row.
    ...giftSeriesRows.map((r) =>
      giftSeriesRowToDraft({ ...r, grantor: r.grantor as "client" | "spouse" }),
    ),
  ];

  // Strip the loader's baked-in gifts — the view re-materialises from
  // workingGifts (single source of truth).
  const giftFreeTree = { ...effectiveTree, gifts: [], giftEvents: [] };

  // CPI for series fan-out. resolvedInflationRate is not exposed on ClientData
  // (it lives on the loader's ResolutionContext), so use the raw plan-settings
  // inflation rate — the only inflation field reachable on effectiveTree.
  const cpi = effectiveTree.planSettings.inflationRate;

  const isMarried =
    client.filingStatus === "married_joint" ||
    client.filingStatus === "married_separate";

  return (
    <EstateFlowView
      key={scenarioId}
      clientId={id}
      scenarioId={scenarioId}
      isMarried={isMarried}
      ownerNames={{
        clientName: client.firstName ?? "Client",
        spouseName: client.spouseName ?? null,
      }}
      initialClientData={giftFreeTree}
      initialGifts={initialGifts}
      cpi={cpi}
      scenarios={scenarioRows}
      snapshots={[]}
    />
  );
}
