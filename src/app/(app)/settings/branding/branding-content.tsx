import Link from "next/link";
import { getBranding } from "@/lib/branding/db";
import {
  getAdvisorProfile,
  listAdvisorProfiles,
  type BrandFields,
} from "@/lib/branding/advisor-profile";
import { listFirmMembers } from "@/lib/crm-tasks/members";
import BrandingForm from "./branding-form";
import AdvisorBrandForm, { type AdvisorBrandInitial } from "./advisor-brand-form";
import AdvisorGrantList from "./advisor-grant-list";

/** Shared by both render paths below — the admin single-advisor view and the
 *  member/own-profile view feed the same 10 fields into `AdvisorBrandForm`. */
function toAdvisorInitial(profile: BrandFields | null): AdvisorBrandInitial {
  return {
    brandName: profile?.brandName ?? null,
    primaryColor: profile?.primaryColor ?? null,
    contactEmail: profile?.contactEmail ?? null,
    contactPhone: profile?.contactPhone ?? null,
    website: profile?.website ?? null,
    address: profile?.address ?? null,
    emailFromName: profile?.emailFromName ?? null,
    emailReplyTo: profile?.emailReplyTo ?? null,
    logoUrl: profile?.logoUrl ?? null,
    faviconUrl: profile?.faviconUrl ?? null,
  };
}

interface Props {
  orgId: string;
  userId: string;
  isAdmin: boolean;
  /**
   * `page.tsx` sets this only after confirming the caller is an admin —
   * never wire a raw querystring value straight into this prop. This
   * component re-checks `isAdmin` itself before honoring it anyway (see
   * below); the page-level gate is the primary control, not the only one.
   */
  advisorUserId?: string;
}

export async function BrandingContent({ orgId, userId, isAdmin, advisorUserId }: Props) {
  // Belt-and-suspenders on top of the page-level gate: even though
  // `page.tsx` only ever sets `advisorUserId` for a verified admin, this
  // component does not take that on faith for a call this security-
  // sensitive — it re-checks `isAdmin` itself before entering the branch
  // that reads another advisor's contact details.
  if (isAdmin && advisorUserId) {
    // Awaited directly rather than used as `<AdminAdvisorBrandView />` JSX:
    // there's a single Suspense boundary for this whole page (in
    // `page.tsx`), so a nested async component buys no extra streaming
    // granularity — only untestability, since a client renderer (as tests
    // use) cannot render an async component that wasn't already resolved.
    return await AdminAdvisorBrandView({ orgId, advisorUserId });
  }

  // Firm branding is admin-only surface — members must not see the firm
  // logo/favicon/color form, so don't fetch it for them either.
  const [firmBranding, advisorProfile, members, advisorProfiles] = await Promise.all([
    isAdmin ? getBranding(orgId) : Promise.resolve(null),
    getAdvisorProfile(orgId, userId),
    isAdmin ? listFirmMembers(orgId) : Promise.resolve([]),
    isAdmin ? listAdvisorProfiles(orgId) : Promise.resolve([]),
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

  const advisorInitial = toAdvisorInitial(advisorProfile);

  // The member list is the spine; a missing `advisor_profiles` row (never
  // saved anything yet) must render as OFF, not be dropped from the list —
  // the row is created lazily by the first upsert (see
  // `listAdvisorProfiles`'s doc comment).
  //
  // The caller themselves is excluded: their own grant is already the "Your
  // brand" section above, and re-listing themselves here would point "Edit
  // brand" at the admin-mode view of their own profile — a confusing detour
  // around the section they're already looking at.
  const brandingEnabledByUser = new Map(
    advisorProfiles.map((p) => [p.advisorUserId, p.brandingEnabled]),
  );
  const grantRows = members
    .filter((m) => m.userId !== userId)
    .map((m) => ({
      userId: m.userId,
      displayName: m.displayName,
      role: m.role,
      brandingEnabled: brandingEnabledByUser.get(m.userId) ?? false,
    }));

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

      {isAdmin ? (
        <section className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-sm font-semibold text-ink">Advisor branding access</h2>
            <p className="text-sm text-ink-3">
              Choose which advisors may set their own brand. When you allow it, that
              advisor&apos;s logo, color, and contact details replace the firm&apos;s on the
              reports and client-facing pages for the clients they advise.
            </p>
          </div>
          <AdvisorGrantList rows={grantRows} />
        </section>
      ) : null}
    </div>
  );
}

/**
 * Admin viewing (or editing) another advisor's brand via
 * `/settings/branding?advisorUserId=<id>`. Only reachable via `advisorUserId`,
 * which `page.tsx` sets ONLY after confirming the caller is an admin — see
 * the comment on the `Props.advisorUserId` field above.
 *
 * `getAdvisorProfile` is called directly here, bypassing
 * `GET /api/advisor-branding`'s `requireOrgAdminOrOwner()` gate entirely.
 * That is safe ONLY because of the page-level check; this function must
 * never be reachable with an unverified `advisorUserId`.
 */
async function AdminAdvisorBrandView({
  orgId,
  advisorUserId,
}: {
  orgId: string;
  advisorUserId: string;
}) {
  const [profile, members] = await Promise.all([
    getAdvisorProfile(orgId, advisorUserId),
    listFirmMembers(orgId),
  ]);
  const subject = members.find((m) => m.userId === advisorUserId);
  const subjectName = subject?.displayName ?? "This advisor";
  const brandingEnabled = profile?.brandingEnabled ?? false;
  const advisorInitial = toAdvisorInitial(profile);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <Link
          href="/settings/branding"
          className="w-fit text-sm text-ink-3 hover:text-ink"
        >
          ← Back to advisor list
        </Link>
        <h1 className="text-base font-medium text-ink">{subjectName}&apos;s brand</h1>
      </div>

      <section className="flex flex-col gap-4">
        <p className="text-sm text-ink-3">
          Set {subjectName}&apos;s logo, color, and contact details. When enabled, these
          override the firm&apos;s branding on the reports and client-facing pages for
          the clients they advise.
        </p>
        <AdvisorBrandForm
          initial={advisorInitial}
          brandingEnabled={brandingEnabled}
          // Not the self-edit `isAdmin || brandingEnabled` formula from the
          // member branch above (that mirrors assertCanEditAdvisorBranding's
          // *self* branch) — the other-advisor branch
          // (advisor-authz.ts:39) is a bare `requireOrgAdminOrOwner()`, so
          // canEdit here is just `isAdmin`, and this function is only ever
          // reached with `isAdmin` true (see the caller's guard above).
          canEdit={true}
          advisorUserId={advisorUserId}
          subjectName={subjectName}
        />
      </section>
    </div>
  );
}
