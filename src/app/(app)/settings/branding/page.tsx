import { Suspense } from "react";
import type { ReactElement } from "react";
import { auth } from "@clerk/nextjs/server";
import { BrandingContent } from "./branding-content";
import BrandingSkeleton from "./loading-skeleton";

type SearchParams = Promise<{ advisorUserId?: string | string[] }>;

// No role gate here: members render their own advisor brand form, admins get
// the firm form *and* their own advisor form — see BrandingContent. The
// admin-only firm surface is gated inside BrandingContent, not at the page.
export default async function BrandingSettingsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}): Promise<ReactElement> {
  const { orgId, userId, orgRole } = await auth();
  if (!orgId || !userId) {
    return <p className="text-sm text-ink-3">Sign in to manage branding.</p>;
  }
  const isAdmin = orgRole === "org:admin";

  // ⚠️ SECURITY: `BrandingContent`'s admin branch renders another advisor's
  // brand by calling `getAdvisorProfile` DIRECTLY — it does not go through
  // `GET /api/advisor-branding`, whose `requireOrgAdminOrOwner()` gate is
  // what stops a member from reading someone else's profile there. So this
  // is the ONLY check standing between `?advisorUserId=<someone-else>` and
  // that advisor's brand name, contact email, phone, and address rendered
  // into this page's HTML for whoever asked. A non-admin's value is read
  // and discarded here, never forwarded — the affordance to view another
  // advisor isn't just hidden from members, it doesn't exist for them.
  const rawAdvisorUserId = (await searchParams).advisorUserId;
  const requested = Array.isArray(rawAdvisorUserId) ? rawAdvisorUserId[0] : rawAdvisorUserId;
  const advisorUserId = isAdmin ? requested?.trim() || undefined : undefined;

  return (
    <Suspense fallback={<BrandingSkeleton />}>
      <BrandingContent
        orgId={orgId}
        userId={userId}
        isAdmin={isAdmin}
        advisorUserId={advisorUserId}
      />
    </Suspense>
  );
}
