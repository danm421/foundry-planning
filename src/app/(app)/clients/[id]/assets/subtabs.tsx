"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactElement } from "react";
import { useScenarioPreservingHref } from "@/hooks/use-scenario-preserving-href";

interface AssetsSubtabsProps {
  clientId: string;
}

export default function AssetsSubtabs({
  clientId,
}: AssetsSubtabsProps): ReactElement {
  const pathname = usePathname();
  const withScenario = useScenarioPreservingHref();

  const root = `/clients/${clientId}/assets`;
  const tabs: { label: string; href: string }[] = [
    { label: "Balance Sheet", href: `${root}/balance-sheet-report` },
    { label: "Entities Cash Flow", href: `${root}/entities-cash-flow` },
    { label: "Investments", href: `${root}/investments` },
  ];

  return (
    <nav
      role="tablist"
      aria-label="Assets sections"
      className="sticky top-14 z-10 -mt-6 mb-2 flex h-9 items-center justify-center gap-1 border-b border-hair bg-paper px-[var(--pad-card)]"
    >
      {tabs.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(tab.href + "/");
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
