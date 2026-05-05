"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactElement } from "react";
import { useScenarioPreservingHref } from "@/hooks/use-scenario-preserving-href";

interface EstatePlanningSubtabsProps {
  clientId: string;
}

export default function EstatePlanningSubtabs({
  clientId,
}: EstatePlanningSubtabsProps): ReactElement {
  const pathname = usePathname();
  const withScenario = useScenarioPreservingHref();

  const root = `/clients/${clientId}/estate-planning`;
  const tabs = [
    { label: "Planning", href: root, exact: true },
    { label: "Estate Tax", href: `${root}/estate-tax`, exact: false },
    { label: "Estate Transfer", href: `${root}/estate-transfer`, exact: false },
    { label: "Gift Tax", href: `${root}/gift-tax`, exact: false },
  ] as const;

  // top-14 (56px) + h-12 (48px) = 104px — pin sub-tabs immediately below
  // the top client-tabs strip.
  return (
    <nav
      role="tablist"
      aria-label="Estate Planning sections"
      className="sticky top-[104px] z-10 flex h-10 items-center gap-5 border-b border-hair bg-paper px-[var(--pad-card)]"
    >
      {tabs.map((tab) => {
        const active = tab.exact
          ? pathname === tab.href
          : pathname === tab.href || pathname.startsWith(tab.href + "/");
        const className = active
          ? "relative h-full inline-flex items-center text-[12px] text-accent border-b-2 border-accent"
          : "relative h-full inline-flex items-center text-[12px] text-ink-3 hover:text-ink";
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
