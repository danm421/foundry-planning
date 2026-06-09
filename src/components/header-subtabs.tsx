"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactElement } from "react";
import { useScenarioPreservingHref } from "@/hooks/use-scenario-preserving-href";

type SubTab = { label: string; href: string; exact?: boolean };

interface Section {
  ariaLabel: string;
  tabs: SubTab[];
}

/**
 * Resolves the sub-report tabs for the section the user is currently in.
 * Only the sections that historically shipped a sub-tab strip get one here
 * (cashflow / assets / estate-planning); everywhere else returns `null` so the
 * header's center column stays empty.
 */
function sectionFor(pathname: string, clientId: string): Section | null {
  const base = `/clients/${clientId}`;

  if (pathname.startsWith(`${base}/cashflow`)) {
    const root = `${base}/cashflow`;
    return {
      ariaLabel: "Cash Flow sections",
      tabs: [
        { label: "Cash Flow", href: root, exact: true },
        { label: "Income Tax", href: `${root}/income-tax` },
        { label: "Tax Ledger", href: `${root}/tax-ledger` },
        { label: "Flows Ledger", href: `${root}/flows-ledger` },
        { label: "Monte Carlo", href: `${root}/monte-carlo` },
        { label: "Timeline", href: `${root}/timeline` },
        { label: "Entities", href: `${root}/entities` },
        { label: "Stock Options", href: `${root}/stock-options` },
      ],
    };
  }

  if (pathname.startsWith(`${base}/assets`)) {
    const root = `${base}/assets`;
    return {
      ariaLabel: "Assets sections",
      tabs: [
        { label: "Balance Sheet", href: `${root}/balance-sheet-report` },
        { label: "Investments", href: `${root}/investments` },
      ],
    };
  }

  if (pathname.startsWith(`${base}/estate-planning`)) {
    const root = `${base}/estate-planning`;
    return {
      ariaLabel: "Estate Planning sections",
      tabs: [
        { label: "Estate Flow", href: `${root}/estate-flow` },
        { label: "Estate Tax", href: `${root}/estate-tax` },
        { label: "Estate Transfer", href: `${root}/estate-transfer` },
        { label: "Liquidity", href: `${root}/liquidity` },
        { label: "Gift Tax", href: `${root}/gift-tax` },
      ],
    };
  }

  return null;
}

/**
 * Sub-report tabs for the active section, rendered inline in the center column
 * of the (already-sticky) client header row — between the identity menu and the
 * plan selector. Returns `null` for sections without sub-reports so the row
 * collapses to just identity + plan selector.
 */
export default function HeaderSubtabs({
  clientId,
}: {
  clientId: string;
}): ReactElement | null {
  const pathname = usePathname();
  const withScenario = useScenarioPreservingHref();
  const section = sectionFor(pathname, clientId);
  if (!section) return null;

  return (
    <nav role="tablist" aria-label={section.ariaLabel} className="flex items-center gap-1">
      {section.tabs.map((tab) => {
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
