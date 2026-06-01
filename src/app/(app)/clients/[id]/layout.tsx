import { notFound } from "next/navigation";
import { Suspense, type ReactElement } from "react";
import { db } from "@/db";
import { clients, crmHouseholdContacts, scenarios as scenariosTable } from "@/db/schema";
import { and, eq, desc, asc } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import ClientHeader from "@/components/client-header";
import { ClientAdvisorName } from "@/components/client-advisor-name";
import { Skeleton } from "@/components/skeleton";
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

  // The client lookup above enforced firm scoping, so the two follow-up
  // queries — CRM contacts (identity source for the header) and the scenario
  // chip row — can run in parallel rather than back-to-back. Neither depends
  // on the other; serializing them just doubled the round-trips before the
  // shell could render. The slow Clerk advisor lookup is no longer on this
  // path — it streams below via <ClientAdvisorName>.
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

  const client = {
    ...clientRow,
    firstName: primary.firstName,
    lastName: primary.lastName,
    dateOfBirth: primary.dateOfBirth,
    spouseName: spouse?.firstName ?? null,
    spouseLastName: spouse?.lastName ?? null,
    spouseDob: spouse?.dateOfBirth ?? null,
  };

  return (
    <ScenarioModeWrapper clientId={id} scenarios={scenarioRows}>
      <ClientHeader
        client={client}
        advisorName={
          <Suspense
            fallback={
              <Skeleton width="6rem" height="0.7rem" className="inline-block align-middle" />
            }
          >
            <ClientAdvisorName advisorId={client.advisorId} />
          </Suspense>
        }
        rightSlot={<ScenarioChipRow clientId={id} scenarios={scenarioRows} />}
      />
      <ScenarioModeBanner clientId={id} scenarios={scenarioRows} />
      <section className="px-[var(--pad-card)] py-6">{children}</section>
    </ScenarioModeWrapper>
  );
}
