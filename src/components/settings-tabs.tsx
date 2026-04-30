import type { ReactElement } from "react";
import Link from "next/link";

interface Props {
  /** Clerk orgRole, e.g. "org:owner" / "org:admin" / "org:member". */
  role: string | null | undefined;
  /** Current pathname so we can highlight the active tab. Pass through from layout. */
  pathname: string;
}

const TABS: { label: string; href: string; roles: ReadonlyArray<string> }[] = [
  { label: "Team", href: "/settings/team", roles: ["org:owner", "org:admin", "org:member"] },
  { label: "Firm", href: "/settings/firm", roles: ["org:owner", "org:admin"] },
  { label: "Billing", href: "/settings/billing", roles: ["org:owner"] },
];

export default function SettingsTabs({ role, pathname }: Props): ReactElement {
  const visible = TABS.filter((t) => role && t.roles.includes(role));
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
