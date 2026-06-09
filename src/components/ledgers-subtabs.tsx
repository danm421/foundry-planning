"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactElement } from "react";
import { useScenarioPreservingHref } from "@/hooks/use-scenario-preserving-href";

const TABS = [
  { label: "Asset Ledger", segment: "asset-ledger" },
  { label: "Tax Ledger", segment: "tax-ledger" },
] as const;

/**
 * Third-level tab strip inside the Cash Flow → Ledgers report. Switches between
 * the Asset Ledger and Tax Ledger sub-reports. Rendered by `ledgers/layout.tsx`
 * so both child pages share it. Routes through `useScenarioPreservingHref` so an
 * active `?scenario=` survives the toggle.
 */
export default function LedgersSubtabs({
  clientId,
}: {
  clientId: string;
}): ReactElement {
  const pathname = usePathname();
  const withScenario = useScenarioPreservingHref();
  const root = `/clients/${clientId}/cashflow/ledgers`;

  return (
    <nav role="tablist" aria-label="Ledgers sections" className="flex items-center gap-1">
      {TABS.map((tab) => {
        const href = `${root}/${tab.segment}`;
        const active = pathname === href || pathname.startsWith(href + "/");
        const className = active
          ? "inline-flex items-center rounded-md border border-accent bg-card-2 px-3 py-1 text-[12px] font-medium text-accent"
          : "inline-flex items-center rounded-md border border-transparent px-3 py-1 text-[12px] text-ink-2 hover:bg-card-2 hover:text-ink";
        return (
          <Link
            key={href}
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
