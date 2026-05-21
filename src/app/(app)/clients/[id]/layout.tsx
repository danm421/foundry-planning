import { notFound } from "next/navigation";
import { clerkClient } from "@clerk/nextjs/server";
import type { ReactElement } from "react";
import { db } from "@/db";
import { clients, crmHouseholdContacts, scenarios as scenariosTable } from "@/db/schema";
import { and, eq, desc, asc } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import ClientHeader from "@/components/client-header";
import { ScenarioModeWrapper } from "@/components/scenario/scenario-mode-wrapper";
import { ScenarioChipRow } from "@/components/scenario/scenario-chip-row";
import { ScenarioModeBanner } from "@/components/scenario/scenario-mode-banner";

interface Props {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}

export default async function ClientLayout({ children, params }: Props): Promise<ReactElement> {
  const [{ id }, firmId] = await Promise.all([params, requireOrgId()]);

  const [clientRow] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, id), eq(clients.firmId, firmId)))
    .limit(1);
  if (!clientRow) notFound();

  // CRM contacts — identity source for the header.
  const contactRows = clientRow.crmHouseholdId
    ? await db
        .select()
        .from(crmHouseholdContacts)
        .where(eq(crmHouseholdContacts.householdId, clientRow.crmHouseholdId))
    : [];
  const primary = contactRows.find((c) => c.role === "primary") ?? null;
  const spouse = contactRows.find((c) => c.role === "spouse") ?? null;

  const client = {
    ...clientRow,
    firstName: primary?.firstName ?? clientRow.firstName,
    lastName: primary?.lastName ?? clientRow.lastName,
    dateOfBirth: primary?.dateOfBirth ?? clientRow.dateOfBirth,
    spouseName: spouse?.firstName ?? clientRow.spouseName,
    spouseLastName: spouse?.lastName ?? clientRow.spouseLastName,
    spouseDob: spouse?.dateOfBirth ?? clientRow.spouseDob,
  };

  // Scenarios for the chip row + create-dialog "copy from" select. The parent
  // client lookup above already enforced firm scoping, so a plain clientId
  // filter is sufficient here. Fields are projected to the minimum the chip
  // row + dialog need — keep this in sync with `ScenarioChip`. Order: base
  // case always leftmost, then alphabetical so chip-row position is stable
  // across reloads.
  const scenarioRows = await db
    .select({
      id: scenariosTable.id,
      name: scenariosTable.name,
      isBaseCase: scenariosTable.isBaseCase,
    })
    .from(scenariosTable)
    .where(eq(scenariosTable.clientId, id))
    .orderBy(desc(scenariosTable.isBaseCase), asc(scenariosTable.name));

  const cc = await clerkClient();
  let advisorName = "Advisor";
  try {
    const advisor = await cc.users.getUser(client.advisorId);
    advisorName =
      [advisor.firstName, advisor.lastName].filter(Boolean).join(" ").trim() ||
      advisor.emailAddresses?.[0]?.emailAddress ||
      "Advisor";
  } catch {
    // advisor user deleted / not found — fall back to "Advisor"
  }

  return (
    <ScenarioModeWrapper clientId={id} scenarios={scenarioRows}>
      <ClientHeader
        client={client}
        advisorName={advisorName}
        rightSlot={<ScenarioChipRow clientId={id} scenarios={scenarioRows} />}
      />
      <ScenarioModeBanner clientId={id} scenarios={scenarioRows} />
      <section className="px-[var(--pad-card)] py-6">{children}</section>
    </ScenarioModeWrapper>
  );
}
