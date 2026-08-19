import type { ReactElement } from "react";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients, crmHouseholdContacts } from "@/db/schema";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { currentUserHasClientPortal } from "@/lib/authz";
import PortalAccessCard from "@/components/portal/portal-access-card";
import PortalEditToggle from "@/components/portal/portal-edit-toggle";
import PortalActivityFeed from "@/components/portal/portal-activity-feed";
import { portalBtn } from "@/components/portal/portal-card";
import PortalManageShell from "@/components/portal/portal-manage-shell";
import PortalFeatureToggles from "@/components/portal/portal-feature-toggles";
import { EyeIcon } from "@/components/portal/portal-icons";
import { toPortalFeatures } from "@/lib/portal/features";
import { portalFeatureColumns } from "@/lib/portal/load-features";
import SendClientForm from "@/components/intake/send-client-form";
import { loadAdvisorDefaultSections, loadSubmittedFormForClient } from "@/lib/intake/queries";

interface Props {
  params: Promise<{ id: string }>;
}

/** Fills the Access panel when the firm has no client portal. The Intake panel
 *  stays alongside it: a blank data-collection send is a public tokenized link
 *  that works without the portal. */
function PortalNotEnabled(): ReactElement {
  return (
    <div className="card p-6">
      <h3 className="text-[15px] font-semibold text-ink">Portal not enabled</h3>
      <p className="mt-2 text-[14px] text-ink-2">
        The client portal gives clients their own sign-in to review accounts,
        upload documents, and fill in the forms you send. It is off for your firm
        — contact Foundry to turn it on.
      </p>
      <p className="mt-3 text-[13px] text-ink-3">
        You can still send a data-collection form from the Intake form tab.
      </p>
    </div>
  );
}

export default async function PortalManagePage({ params }: Props): Promise<ReactElement> {
  const { id } = await params;
  const { orgId, userId } = await requireOrgAndUser();
  // Off until ops switches it on for this firm or this advisor. Only the
  // portal-specific panels go dark — the Intake form panel below works without
  // the portal.
  const portalEnabled = await currentUserHasClientPortal();
  const defaultSections = await loadAdvisorDefaultSections(orgId, userId);

  const [row] = await db
    .select({
      clerkUserId: clients.clerkUserId,
      portalInvitedAt: clients.portalInvitedAt,
      portalEditEnabled: clients.portalEditEnabled,
      crmHouseholdId: clients.crmHouseholdId,
      ...portalFeatureColumns,
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
    <div className="space-y-6">
      <header className="space-y-1">
        {/* Preview sits on the title row rather than in the section nav — it
            leaves the page (new tab) instead of swapping a panel, so it was
            the one nav item that never had a panel to come back to. */}
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-[20px] font-semibold text-ink">Manage Portal</h2>
          {portalEnabled && (
            <Link
              href={`/clients/${id}/portal/preview`}
              target="_blank"
              rel="noopener noreferrer"
              className={portalBtn.accent}
              title="See exactly what the client sees — read-only, works before you send an invite."
            >
              <EyeIcon />
              Preview Client Portal
            </Link>
          )}
        </div>
        <p className="text-[13px] text-ink-3">
          {portalEnabled
            ? "Control portal access, send data-collection forms, and review what the client changes."
            : "Send data-collection forms. Portal access is not enabled for your firm."}
        </p>
      </header>
      <PortalManageShell
        access={
          portalEnabled ? (
            <PortalAccessCard
              clientId={id}
              status={status}
              primaryEmail={primaryEmail}
              invitedAt={row?.portalInvitedAt ?? null}
              clerkUserId={row?.clerkUserId ?? null}
            />
          ) : (
            <PortalNotEnabled />
          )
        }
        intake={
          <SendClientForm
            clientId={id}
            primaryEmail={primaryEmail}
            spouseEmail={spouseEmail}
            primaryName={primaryName}
            spouseName={spouseName}
            clientAlreadyBound={!!row?.clerkUserId}
            pendingFormId={pending?.id ?? null}
            defaultSections={defaultSections}
            portalEnabled={portalEnabled}
          />
        }
        features={
          portalEnabled ? (
            <PortalFeatureToggles clientId={id} initialFeatures={toPortalFeatures(row)} />
          ) : null
        }
        editing={
          portalEnabled ? (
            <PortalEditToggle clientId={id} initialEnabled={row?.portalEditEnabled ?? false} />
          ) : null
        }
        activity={portalEnabled ? <PortalActivityFeed clientId={id} /> : null}
      />
    </div>
  );
}
