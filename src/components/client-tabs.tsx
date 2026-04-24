"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactElement } from "react";

const TABS = [
  { label: "Overview", href: "overview" },
  { label: "Details", href: "client-data" },
  { label: "Balance Sheet", href: "balance-sheet-report" },
  { label: "Cash Flow", href: "cashflow" },
  { label: "Investments", href: "investments" },
  { label: "Timeline", href: "timeline" },
  { label: "Estate Tax", href: "estate-tax-report" },
  { label: "Monte Carlo", href: "monte-carlo" },
] as const;

interface ClientTabsProps {
  clientId: string;
}

export default function ClientTabs({ clientId }: ClientTabsProps): ReactElement {
  const pathname = usePathname();

  return (
    <nav
      role="tablist"
      className="sticky top-14 z-10 flex h-12 items-center gap-6 border-b border-hair bg-paper px-[var(--pad-card)]"
    >
      {TABS.map((tab) => {
        const href = `/clients/${clientId}/${tab.href}`;
        const active = pathname.startsWith(href);
        const className = active
          ? "relative h-full inline-flex items-center text-[13px] text-accent border-b-2 border-accent"
          : "relative h-full inline-flex items-center text-[13px] text-ink-3 hover:text-ink";
        return (
          <Link
            key={tab.href}
            href={href}
            role="tab"
            aria-selected={active || undefined}
            className={className}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
