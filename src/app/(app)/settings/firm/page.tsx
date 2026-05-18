import { Suspense } from "react";
import type { ReactElement } from "react";
import { auth } from "@clerk/nextjs/server";
import { ForbiddenError, requireOrgAdminOrOwner } from "@/lib/authz";
import Forbidden from "../forbidden";
import { FirmContent } from "./firm-content";
import FirmSkeleton from "./loading-skeleton";

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

  const meta =
    (sessionClaims as { org_public_metadata?: { is_founder?: boolean } } | null)
      ?.org_public_metadata ?? {};
  const isFounder = meta.is_founder === true;

  return (
    <Suspense fallback={<FirmSkeleton />}>
      <FirmContent orgId={orgId} isFounder={isFounder} />
    </Suspense>
  );
}
