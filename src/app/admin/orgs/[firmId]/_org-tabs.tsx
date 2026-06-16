"use client";

import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";

const TABS: Array<{ segment: string | null; label: string; href: string }> = [
  { segment: null, label: "Overview", href: "" },
  { segment: "entitlements", label: "Entitlements", href: "/entitlements" },
];

const SOON = ["Billing", "Impersonate"]; // built in later plans

export default function OrgTabs({ firmId }: { firmId: string }) {
  const active = useSelectedLayoutSegment();
  const base = `/admin/orgs/${firmId}`;
  return (
    <nav className="flex gap-1 border-b border-neutral-800 text-sm">
      {TABS.map((t) => {
        const isActive = active === t.segment;
        return (
          <Link
            key={t.label}
            href={`${base}${t.href}`}
            className={`-mb-px border-b-2 px-3 py-2 ${
              isActive
                ? "border-sky-400 text-sky-300"
                : "border-transparent text-neutral-400 hover:text-neutral-200"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
      {SOON.map((label) => (
        <span
          key={label}
          title="Coming soon"
          className="-mb-px cursor-default border-b-2 border-transparent px-3 py-2 text-neutral-600"
        >
          {label}
        </span>
      ))}
    </nav>
  );
}
