import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { scenarios as scenariosTable, clients } from "@/db/schema";
import { requireOrgId } from "@/lib/db-helpers";
import { loadLayout } from "@/lib/comparison/load-layout";
import { ComparisonPageClient } from "./comparison-page-client";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}

function parseUrlPlanIds(sp: Record<string, string | undefined>): string[] | null {
  const raw = sp.plans;
  if (raw && raw.length > 0) {
    return raw.split(",").map((t) => t.trim()).filter(Boolean);
  }
  if (sp.left !== undefined || sp.right !== undefined) {
    return [sp.left ?? "base", sp.right ?? "base"];
  }
  return null;
}

export default async function ComparisonPage({ params, searchParams }: PageProps) {
  const { id: clientId } = await params;
  const sp = await searchParams;
  const firmId = await requireOrgId();

  const [client, scenarios, initialLayout] = await Promise.all([
    db
      .select({
        firstName: clients.firstName,
        lastName: clients.lastName,
      })
      .from(clients)
      .where(and(eq(clients.id, clientId), eq(clients.firmId, firmId)))
      .then((rows) => rows[0] ?? null),
    db
      .select({
        id: scenariosTable.id,
        name: scenariosTable.name,
        isBaseCase: scenariosTable.isBaseCase,
      })
      .from(scenariosTable)
      .innerJoin(clients, eq(clients.id, scenariosTable.clientId))
      .where(and(eq(scenariosTable.clientId, clientId), eq(clients.firmId, firmId))),
    loadLayout(clientId, firmId, {
      primaryScenarioId: "base",
      urlPlanIds: parseUrlPlanIds(sp),
      defaultTitle: undefined, // resolved below after we know the client name
    }),
  ]);

  if (!client) {
    const { notFound } = await import("next/navigation");
    notFound();
  }

  const scenarioLookup: { id: string; name: string }[] = [
    { id: "base", name: "Base case" },
    ...scenarios.map((s) => ({ id: s.id, name: s.name })),
  ];

  // If the layout came back with the generic default title, prefer a personalized
  // one based on the client name. We don't re-save here; the next user save will.
  const personalizedLayout =
    initialLayout.title === "Comparison Report" && client
      ? { ...initialLayout, title: `${client.firstName} ${client.lastName} — Report`.trim() }
      : initialLayout;

  return (
    <ComparisonPageClient
      clientId={clientId}
      initialLayout={personalizedLayout}
      scenarios={scenarioLookup}
      primaryScenarioId="base"
    />
  );
}
