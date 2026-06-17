import { notFound, redirect } from "next/navigation";
import type { ReactElement } from "react";
import { db } from "@/db";
import { crmHouseholds, crmHouseholdContacts, scenarios as scenariosTable } from "@/db/schema";
import { eq, desc, asc } from "drizzle-orm";
import { requireClientAccess } from "@/lib/clients/authz";
import ClientHeader from "@/components/client-header";
import HeaderSubtabs from "@/components/header-subtabs";
import type { PersonInfo } from "@/components/client-identity-menu";
import ReportSectionLabel from "@/components/report-section-label";
import { ScenarioModeWrapper } from "@/components/scenario/scenario-mode-wrapper";
import { ScenarioChipRow } from "@/components/scenario/scenario-chip-row";
import { ScenarioModeBanner } from "@/components/scenario/scenario-mode-banner";
import { ScenarioDrawerProvider } from "@/components/scenario/scenario-drawer-provider";
import { CopilotMount } from "@/components/copilot/copilot-mount";

interface Props {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}

export default async function ClientLayout({ children, params }: Props): Promise<ReactElement> {
  const { id } = await params;
  const access = await requireClientAccess(id).catch(() => null);
  if (!access) notFound();
  const { client: clientRow } = access;

  const [household] = await db
    .select({ deletedAt: crmHouseholds.deletedAt })
    .from(crmHouseholds)
    .where(eq(crmHouseholds.id, clientRow.crmHouseholdId))
    .limit(1);
  if (household?.deletedAt) redirect("/clients?view=deleted");

  // The client lookup above enforced firm scoping, so the two follow-up
  // queries — CRM contacts (identity source for the header) and the scenario
  // chip row — can run in parallel rather than back-to-back. Neither depends
  // on the other; serializing them just doubled the round-trips before the
  // shell could render.
  const [contactRows, scenarioRows] = await Promise.all([
    db
      .select()
      .from(crmHouseholdContacts)
      .where(eq(crmHouseholdContacts.householdId, clientRow.crmHouseholdId)),
    // Fields projected to the minimum the chip row + create-dialog need — keep
    // in sync with `ScenarioChip`. Order: base case always leftmost, then
    // alphabetical so chip-row position is stable across reloads.
    db
      .select({
        id: scenariosTable.id,
        name: scenariosTable.name,
        isBaseCase: scenariosTable.isBaseCase,
      })
      .from(scenariosTable)
      .where(eq(scenariosTable.clientId, id))
      .orderBy(desc(scenariosTable.isBaseCase), asc(scenariosTable.name)),
  ]);

  const primary = contactRows.find((c) => c.role === "primary");
  const spouse = contactRows.find((c) => c.role === "spouse");
  if (!primary?.dateOfBirth) notFound();

  // Single-source the projection so adding a field to PersonInfo is a one-line
  // change here (the return type makes a missed field a compile error).
  const toPerson = (
    c: (typeof contactRows)[number],
    role: "primary" | "spouse",
  ): PersonInfo => ({
    role,
    firstName: c.firstName,
    lastName: c.lastName,
    dateOfBirth: c.dateOfBirth,
    email: c.email,
    phone: c.phone,
    mobile: c.mobile,
  });

  const people: PersonInfo[] = [
    toPerson(primary, "primary"),
    ...(spouse ? [toPerson(spouse, "spouse")] : []),
  ];

  const spouseFirst = spouse?.firstName ?? null;
  const spouseLast = spouse?.lastName ?? primary.lastName;
  const householdTitle = spouseFirst
    ? `${primary.firstName} & ${spouseFirst} ${spouseLast}`.trim()
    : `${primary.firstName} ${primary.lastName}`.trim();

  return (
    <ScenarioModeWrapper clientId={id} scenarios={scenarioRows}>
      <ReportSectionLabel label={householdTitle} />
      <ClientHeader
        clientId={id}
        people={people}
        centerSlot={<HeaderSubtabs clientId={id} />}
        rightSlot={<ScenarioChipRow clientId={id} scenarios={scenarioRows} />}
      />
      <ScenarioModeBanner clientId={id} scenarios={scenarioRows} />
      <ScenarioDrawerProvider>
        <section className="px-[var(--pad-card)] pb-6">{children}</section>
        <CopilotMount
          clientId={id}
          clientName={householdTitle}
          enabled={process.env.COPILOT_ENABLED === "true"}
          scenarioNames={Object.fromEntries(scenarioRows.map((s) => [s.id, s.name]))}
        />
      </ScenarioDrawerProvider>
    </ScenarioModeWrapper>
  );
}
