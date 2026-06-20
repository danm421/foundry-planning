import type { ReactElement } from "react";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients, crmHouseholdContacts } from "@/db/schema";
import ProfileHouseholdForm from "@/components/portal/profile-household-form";

interface Props {
  clientId: string;
  previewing?: boolean;
}

export default async function HouseholdSection({
  clientId,
  previewing = false,
}: Props): Promise<ReactElement> {
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

  if (!client) {
    return (
      <div className="p-5 text-[13px] text-ink-3">Household not found.</div>
    );
  }

  const contacts = client.crmHouseholdId
    ? await db
        .select()
        .from(crmHouseholdContacts)
        .where(eq(crmHouseholdContacts.householdId, client.crmHouseholdId))
    : [];

  const primary = contacts.find((c) => c.role === "primary") ?? null;
  const spouse = contacts.find((c) => c.role === "spouse") ?? null;

  const editEnabled = previewing ? false : client.portalEditEnabled;

  return (
    <div className="max-w-2xl space-y-5 p-5">
      <header>
        <h1 className="text-[18px] font-semibold text-ink">Household</h1>
      </header>

      <section className="space-y-1 rounded-md border border-hair bg-card-2 p-4 text-[13px] text-ink-2">
        <div>
          <span className="text-ink-3">Filing status:</span>{" "}
          {client.filingStatus}
        </div>
        <div>
          <span className="text-ink-3">Plan horizon:</span> through age{" "}
          {client.lifeExpectancy}
        </div>
      </section>

      <ProfileHouseholdForm
        primary={
          primary
            ? {
                id: primary.id,
                firstName: primary.firstName,
                lastName: primary.lastName,
                email: primary.email,
                phone: primary.phone,
              }
            : null
        }
        spouse={
          spouse
            ? {
                id: spouse.id,
                firstName: spouse.firstName,
                lastName: spouse.lastName,
                email: spouse.email,
                phone: spouse.phone,
              }
            : null
        }
        editEnabled={editEnabled}
      />
    </div>
  );
}
