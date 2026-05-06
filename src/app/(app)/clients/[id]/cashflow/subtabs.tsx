"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactElement } from "react";
import { useScenarioPreservingHref } from "@/hooks/use-scenario-preserving-href";

interface CashFlowSubtabsProps {
  clientId: string;
}

export default function CashFlowSubtabs({
  clientId,
}: CashFlowSubtabsProps): ReactElement {
  const pathname = usePathname();
  const withScenario = useScenarioPreservingHref();

  const root = `/clients/${clientId}/cashflow`;
  const tabs: { label: string; href: string; exact?: true }[] = [
    { label: "Cash Flow", href: root, exact: true },
    { label: "Income Tax", href: `${root}/income-tax` },
    { label: "Monte Carlo", href: `${root}/monte-carlo` },
    { label: "Timeline", href: `${root}/timeline` },
  ];

  return (
    <nav
      role="tablist"
      aria-label="Cash Flow sections"
      className="sticky top-14 z-10 -mt-6 -mb-4 flex h-9 items-center justify-center gap-1 border-b border-hair bg-paper px-[var(--pad-card)]"
    >
      {tabs.map((tab) => {
        const active = tab.exact
          ? pathname === tab.href
          : pathname === tab.href || pathname.startsWith(tab.href + "/");
        const className = active
          ? "inline-flex items-center rounded-md border border-accent bg-card-2 px-3 py-1 text-[12px] font-medium text-accent"
          : "inline-flex items-center rounded-md border border-transparent px-3 py-1 text-[12px] text-ink-2 hover:bg-card-2 hover:text-ink";
        return (
          <Link
            key={tab.href}
            href={withScenario(tab.href)}
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
