import type { ReactElement } from "react";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients, crmHouseholdContacts } from "@/db/schema";
import { requireOrgId } from "@/lib/db-helpers";
import PortalAccessCard from "@/components/portal/portal-access-card";
import PortalEditToggle from "@/components/portal/portal-edit-toggle";
import PortalActivityFeed from "@/components/portal/portal-activity-feed";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function PortalManagePage({ params }: Props): Promise<ReactElement> {
  const { id } = await params;
  await requireOrgId(); // layout already enforces firm scoping on `clients`

  const [row] = await db
    .select({
      clerkUserId: clients.clerkUserId,
      portalInvitedAt: clients.portalInvitedAt,
      portalEditEnabled: clients.portalEditEnabled,
      crmHouseholdId: clients.crmHouseholdId,
    })
    .from(clients)
    .where(eq(clients.id, id))
    .limit(1);

  let primaryEmail = "";
  if (row?.crmHouseholdId) {
    const contacts = await db
      .select({ email: crmHouseholdContacts.email, role: crmHouseholdContacts.role })
      .from(crmHouseholdContacts)
      .where(eq(crmHouseholdContacts.householdId, row.crmHouseholdId));
    primaryEmail = contacts.find((c) => c.role === "primary")?.email ?? "";
  }

  const status: "not_invited" | "invited" | "active" = row?.clerkUserId
    ? "active"
    : row?.portalInvitedAt
      ? "invited"
      : "not_invited";

  return (
    <div className="max-w-2xl space-y-6">
      <h2 className="text-[20px] font-semibold text-ink">Manage Portal</h2>
      <PortalAccessCard
        clientId={id}
        status={status}
        primaryEmail={primaryEmail}
        invitedAt={row?.portalInvitedAt ?? null}
        clerkUserId={row?.clerkUserId ?? null}
      />
      <PortalEditToggle clientId={id} initialEnabled={row?.portalEditEnabled ?? false} />
      <PortalActivityFeed clientId={id} />
    </div>
  );
}
