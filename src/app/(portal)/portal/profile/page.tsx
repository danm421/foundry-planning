import type { ReactElement } from "react";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients, crmHouseholdContacts } from "@/db/schema";
import { requireClientPortalAccess } from "@/lib/authz";
import ProfileHouseholdForm from "@/components/portal/profile-household-form";

export default async function HouseholdPage(): Promise<ReactElement> {
  const { clientId } = await requireClientPortalAccess();

  const [client] = await db
    .select({
      crmHouseholdId: clients.crmHouseholdId,
      filingStatus: clients.filingStatus,
      lifeExpectancy: clients.lifeExpectancy,
      portalEditEnabled: clients.portalEditEnabled,
    })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);

  const contacts = await db
    .select()
    .from(crmHouseholdContacts)
    .where(eq(crmHouseholdContacts.householdId, client.crmHouseholdId));

  const primary = contacts.find((c) => c.role === "primary");
  const spouse = contacts.find((c) => c.role === "spouse");

  return (
    <div className="p-5 max-w-2xl space-y-5">
      <header>
        <h1 className="text-[18px] font-semibold text-ink">Household</h1>
      </header>

      <section className="rounded-md border border-hair bg-card-2 p-4 text-[13px] text-ink-2 space-y-1">
        <div><span className="text-ink-3">Filing status:</span> {client.filingStatus}</div>
        <div><span className="text-ink-3">Plan horizon:</span> through age {client.lifeExpectancy}</div>
      </section>

      <ProfileHouseholdForm
        primary={primary ?? null}
        spouse={spouse ?? null}
        editEnabled={client.portalEditEnabled}
      />
    </div>
  );
}
