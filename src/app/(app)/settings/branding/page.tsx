import { Suspense } from "react";
import type { ReactElement } from "react";
import { auth } from "@clerk/nextjs/server";
import { ForbiddenError, requireOrgAdminOrOwner } from "@/lib/authz";
import Forbidden from "../forbidden";
import { BrandingContent } from "./branding-content";
import BrandingSkeleton from "./loading-skeleton";

export default async function BrandingSettingsPage(): Promise<ReactElement> {
  try {
    await requireOrgAdminOrOwner();
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return <Forbidden requiredRole="admin or owner" />;
    }
    throw err;
  }

  const { orgId } = await auth();
  if (!orgId) return <Forbidden requiredRole="admin or owner" />;

  return (
    <Suspense fallback={<BrandingSkeleton />}>
      <BrandingContent orgId={orgId} />
    </Suspense>
  );
}
