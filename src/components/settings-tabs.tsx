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
  roles?: ReadonlyArray<string>;
  billingContact?: boolean;
}[] = [
  { label: "Team", href: "/settings/team", roles: ["org:admin", "org:member"] },
  { label: "Sharing", href: "/settings/sharing", roles: ["org:admin", "org:member"] },
  { label: "Firm", href: "/settings/firm", roles: ["org:admin"] },
  { label: "Branding", href: "/settings/branding", roles: ["org:admin"] },
  { label: "Integrations", href: "/settings/integrations", roles: ["org:admin"] },
  { label: "Billing", href: "/settings/billing", billingContact: true },
];

export default function SettingsTabs({ role, isBillingContact, pathname }: Props): ReactElement {
  const visible = TABS.filter((t) =>
    t.billingContact ? isBillingContact : !!(role && t.roles!.includes(role)),
  );
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
