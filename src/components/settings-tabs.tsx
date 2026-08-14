import type { ReactElement } from "react";
import Link from "next/link";

interface Props {
  /** Clerk orgRole, e.g. "org:admin" / "org:member". */
  role: string | null | undefined;
  /** Whether the current user is the firm's billing contact. Gates the Billing tab. */
  isBillingContact: boolean;
  /** Current pathname so we can highlight the active tab. Pass through from layout. */
  pathname: string;
}

const TABS: {
  label: string;
  href: string;
  /** Admin-only surface. A tab with neither this nor `billingContact` is a
   *  member surface, visible to everyone in the firm. */
  adminOnly?: boolean;
  /** The billing contact is a per-firm pointer, not a role — see authz.ts. */
  billingContact?: boolean;
}[] = [
  { label: "Team", href: "/settings/team" },
  { label: "Sharing", href: "/settings/sharing" },
  { label: "Firm", href: "/settings/firm", adminOnly: true },
  { label: "Branding", href: "/settings/branding" },
  // No `adminOnly`: a voice profile is per advisor, so every member of the firm
  // has one of their own. The admin-only part is the "save it for the whole
  // firm" checkbox inside the panel, gated there and re-checked by both routes.
  { label: "Voice", href: "/settings/voice" },
  { label: "Integrations", href: "/settings/integrations", adminOnly: true },
  { label: "Billing", href: "/settings/billing", billingContact: true },
];

export default function SettingsTabs({ role, isBillingContact, pathname }: Props): ReactElement {
  // The member tabs are deliberately NOT an allowlist of role strings. The
  // proxy already redirects every org-less request away from /settings (to the
  // org picker or the portal), so anyone rendering this strip is a firm
  // member — and a role string we don't recognise (a custom Clerk role, a
  // legacy `basic_member`, or a session whose org claim we couldn't read) is
  // still a firm member. Matching exactly ["org:admin", "org:member"] turned
  // that case into an EMPTY tab strip: no Team, no Sharing, no Branding, and
  // nothing on screen to explain why. That was the live bug — a granted
  // advisor could not reach Branding at all.
  //
  // Showing a member tab grants nothing on its own: Clerk's OrganizationProfile
  // scopes Team, sharing-content.tsx scopes its query unless the caller is
  // org:admin, and the Branding page gates the firm form, the grant list and
  // the other-advisor view on `isAdmin` while every write re-checks
  // assertCanEditAdvisorBranding server-side.
  const visible = TABS.filter((t) => {
    if (t.billingContact) return isBillingContact;
    if (t.adminOnly) return role === "org:admin";
    return true;
  });
  return (
    <nav className="flex gap-1 border-b border-hair px-[var(--pad-card)]">
      {visible.map((t) => {
        const active = pathname === t.href || pathname.startsWith(t.href + "/");
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`px-3 py-2 text-sm border-b-2 -mb-px ${
              active
                ? "border-ink text-ink font-medium"
                : "border-transparent text-ink-3 hover:text-ink"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
