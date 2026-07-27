import { getBranding } from "@/lib/branding/db";
import { getAdvisorProfile } from "@/lib/branding/advisor-profile";
import BrandingForm from "./branding-form";
import AdvisorBrandForm from "./advisor-brand-form";

interface Props {
  orgId: string;
  userId: string;
  isAdmin: boolean;
}

export async function BrandingContent({ orgId, userId, isAdmin }: Props) {
  // Firm branding is admin-only surface — members must not see the firm
  // logo/favicon/color form, so don't fetch it for them either.
  const [firmBranding, advisorProfile] = await Promise.all([
    isAdmin ? getBranding(orgId) : Promise.resolve(null),
    getAdvisorProfile(orgId, userId),
  ]);

  // No row yet means the advisor has never saved anything — render that as
  // all-null fields with the grant off, not as an error.
  const brandingEnabled = advisorProfile?.brandingEnabled ?? false;
  // Mirrors the self-edit branch of assertCanEditAdvisorBranding
  // (src/lib/branding/advisor-authz.ts) — a firm admin may always edit their
  // own brand, grant on or off. This is UI-only: the PUT route and the asset
  // actions re-check the real rule server-side regardless of what this
  // renders, so a drift here is a confusing UX (edit form that then 403s, or
  // a read-only view an admin could actually save from), not a privilege
  // bug. Keep it in sync with advisor-authz.ts's self branch if that rule
  // ever changes; if 15c adds an admin-viewing-another-advisor page, this
  // formula does NOT generalize (canEdit there is just `isAdmin`) — it needs
  // its own derivation, not a copy-paste of this line.
  const canEdit = isAdmin || brandingEnabled;

  const advisorInitial = {
    brandName: advisorProfile?.brandName ?? null,
    primaryColor: advisorProfile?.primaryColor ?? null,
    contactEmail: advisorProfile?.contactEmail ?? null,
    contactPhone: advisorProfile?.contactPhone ?? null,
    website: advisorProfile?.website ?? null,
    address: advisorProfile?.address ?? null,
    emailFromName: advisorProfile?.emailFromName ?? null,
    emailReplyTo: advisorProfile?.emailReplyTo ?? null,
    logoUrl: advisorProfile?.logoUrl ?? null,
    faviconUrl: advisorProfile?.faviconUrl ?? null,
  };

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-base font-medium text-ink">Branding</h1>

      {isAdmin ? (
        <section className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-sm font-semibold text-ink">Firm</h2>
            <p className="text-sm text-ink-3">
              Upload your firm&apos;s logo and favicon and pick a primary color. These
              assets will be used in reports.
            </p>
          </div>
          <BrandingForm
            initial={
              firmBranding ?? { logoUrl: null, faviconUrl: null, primaryColor: null }
            }
          />
        </section>
      ) : null}

      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-semibold text-ink">Your brand</h2>
          <p className="text-sm text-ink-3">
            Set your own logo, color, and contact details. When enabled, these
            override your firm&apos;s branding on the reports and client-facing pages
            for the clients you advise.
          </p>
        </div>
        <AdvisorBrandForm
          initial={advisorInitial}
          brandingEnabled={brandingEnabled}
          canEdit={canEdit}
        />
      </section>
    </div>
  );
}
