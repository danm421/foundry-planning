import { db } from "@/db";
import { clients, entities } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { notFound } from "next/navigation";
import { requireOrgId } from "@/lib/db-helpers";
import BalanceSheetReportView from "@/components/balance-sheet-report-view";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function BalanceSheetReportPage({ params }: PageProps) {
  const firmId = await requireOrgId();
  const { id } = await params;

  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));

  if (!client) {
    // Parent layout already handles the 404 case via notFound(); this is a
    // belt-and-suspenders fallback if scope ever drifts.
    notFound();
  }

  const entityRows = await db
    .select()
    .from(entities)
    .where(eq(entities.clientId, id));

  const isMarried =
    client.filingStatus === "married_joint" ||
    client.filingStatus === "married_separate";

  const ownerNames = {
    clientName: client.firstName ?? "Client",
    spouseName: client.spouseName ?? null,
  };

  const ownerDobs = {
    clientDob: client.dateOfBirth,
    spouseDob: client.spouseDob ?? null,
  };

  const entityInfos = entityRows.map((e) => ({
    id: e.id,
    name: e.name,
    entityType: e.entityType,
  }));

  return (
    <BalanceSheetReportView
      clientId={id}
      isMarried={isMarried}
      ownerNames={ownerNames}
      ownerDobs={ownerDobs}
      entities={entityInfos}
    />
  );
}
