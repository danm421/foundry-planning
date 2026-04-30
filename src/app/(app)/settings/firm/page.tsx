import type { ReactElement } from "react";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { ForbiddenError, requireOrgAdminOrOwner } from "@/lib/authz";
import Forbidden from "../forbidden";
import FirmNameForm from "./firm-name-form";

export default async function FirmSettingsPage(): Promise<ReactElement> {
  try {
    await requireOrgAdminOrOwner();
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return <Forbidden requiredRole="admin or owner" />;
    }
    throw err;
  }

  const { orgId, sessionClaims } = await auth();
  if (!orgId) return <Forbidden requiredRole="admin or owner" />;

  const cc = await clerkClient();
  const org = await cc.organizations.getOrganization({ organizationId: orgId });
  const meta =
    (sessionClaims as { org_public_metadata?: { is_founder?: boolean } } | null)
      ?.org_public_metadata ?? {};
  const isFounder = meta.is_founder === true;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-base font-medium text-ink">Firm</h1>
      <FirmNameForm initial={org.name} firmId={orgId} isFounder={isFounder} />
    </div>
  );
}
