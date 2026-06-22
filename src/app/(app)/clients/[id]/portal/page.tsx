import type { ReactElement } from "react";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients, crmHouseholdContacts } from "@/db/schema";
import { requireOrgId } from "@/lib/db-helpers";
import PortalAccessCard from "@/components/portal/portal-access-card";
import PortalEditToggle from "@/components/portal/portal-edit-toggle";
import PortalActivityFeed from "@/components/portal/portal-activity-feed";
import SendClientForm from "@/components/intake/send-client-form";
import { loadSubmittedFormForClient } from "@/lib/intake/queries";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function PortalManagePage({ params }: Props): Promise<ReactElement> {
  const { id } = await params;
  const orgId = await requireOrgId();

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
  let spouseEmail: string | undefined;
  let primaryName: string | undefined;
  let spouseName: string | undefined;

  if (row?.crmHouseholdId) {
    const contacts = await db
      .select({
        email: crmHouseholdContacts.email,
        role: crmHouseholdContacts.role,
        firstName: crmHouseholdContacts.firstName,
        lastName: crmHouseholdContacts.lastName,
        preferredName: crmHouseholdContacts.preferredName,
      })
      .from(crmHouseholdContacts)
      .where(eq(crmHouseholdContacts.householdId, row.crmHouseholdId));

    const primary = contacts.find((c) => c.role === "primary");
    const spouse = contacts.find((c) => c.role === "spouse");

    primaryEmail = primary?.email ?? "";
    spouseEmail = spouse?.email ?? undefined;
    if (primary) {
      const fullName = `${primary.firstName} ${primary.lastName}`.trim();
      primaryName = primary.preferredName ?? (fullName || undefined);
    }
    if (spouse) {
      const fullName = `${spouse.firstName} ${spouse.lastName}`.trim();
      spouseName = spouse.preferredName ?? (fullName || undefined);
    }
  }

  const pending = await loadSubmittedFormForClient(id, orgId);

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
      <SendClientForm
        clientId={id}
        primaryEmail={primaryEmail}
        spouseEmail={spouseEmail}
        primaryName={primaryName}
        spouseName={spouseName}
        clientAlreadyBound={!!row?.clerkUserId}
        pendingFormId={pending?.id ?? null}
      />
      <div className="rounded-md border border-hair bg-card-2 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[14px] font-medium text-ink">
              Preview as client
            </div>
            <div className="mt-0.5 text-[12px] text-ink-3">
              See exactly what the client sees in their portal — even before
              you send an invite. Read-only.
            </div>
          </div>
          <Link
            href={`/clients/${id}/portal/preview`}
            className="inline-flex items-center rounded-md border border-accent bg-accent/15 px-3 py-1.5 text-[13px] font-medium text-accent"
          >
            Open preview
          </Link>
        </div>
      </div>
      <PortalEditToggle clientId={id} initialEnabled={row?.portalEditEnabled ?? false} />
      <PortalActivityFeed clientId={id} />
    </div>
  );
}
