"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactElement } from "react";
import { useScenarioPreservingHref } from "@/hooks/use-scenario-preserving-href";

const TABS = [
  { label: "Overview", href: "overview" },
  { label: "Details", href: "client-data" },
  { label: "Balance Sheet", href: "balance-sheet-report" },
  { label: "Cash Flow", href: "cashflow" },
  { label: "Investments", href: "investments" },
  { label: "Timeline", href: "timeline" },
  { label: "Estate Tax", href: "estate-tax-report" },
  { label: "Estate Transfer", href: "estate-transfer-report" },
  { label: "Estate Planning", href: "estate-planning" },
  { label: "Monte Carlo", href: "monte-carlo" },
] as const;

interface ClientTabsProps {
  clientId: string;
}

export default function ClientTabs({ clientId }: ClientTabsProps): ReactElement {
  const pathname = usePathname();
  const withScenario = useScenarioPreservingHref();

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
            href={withScenario(href)}
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
