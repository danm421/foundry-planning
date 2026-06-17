"use client";

import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";

const TABS: Array<{ segment: string | null; label: string; href: string }> = [
  { segment: null, label: "Overview", href: "" },
  { segment: "entitlements", label: "Entitlements", href: "/entitlements" },
  { segment: "billing", label: "Billing", href: "/billing" },
  { segment: "impersonate", label: "Impersonate", href: "/impersonate" },
];

export default function OrgTabs({ firmId }: { firmId: string }) {
  const active = useSelectedLayoutSegment();
  const base = `/admin/orgs/${firmId}`;
  return (
    <nav className="flex gap-1 border-b border-hair text-sm">
      {TABS.map((t) => {
        const isActive = active === t.segment;
        return (
          <Link
            key={t.label}
            href={`${base}${t.href}`}
            className={`-mb-px border-b-2 px-3 py-2 transition ${
              isActive
                ? "border-accent text-accent"
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
