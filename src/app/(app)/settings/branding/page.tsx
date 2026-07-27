import { Suspense } from "react";
import type { ReactElement } from "react";
import { auth } from "@clerk/nextjs/server";
import { BrandingContent } from "./branding-content";
import BrandingSkeleton from "./loading-skeleton";

// No role gate here: members render their own advisor brand form, admins get
// the firm form *and* their own advisor form — see BrandingContent. The
// admin-only firm surface is gated inside BrandingContent, not at the page.
export default async function BrandingSettingsPage(): Promise<ReactElement> {
  const { orgId, userId, orgRole } = await auth();
  if (!orgId || !userId) {
    return <p className="text-sm text-ink-3">Sign in to manage branding.</p>;
  }

  return (
    <Suspense fallback={<BrandingSkeleton />}>
      <BrandingContent orgId={orgId} userId={userId} isAdmin={orgRole === "org:admin"} />
    </Suspense>
  );
}
