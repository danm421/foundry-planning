"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactElement } from "react";
import Breadcrumb from "./breadcrumb";
import { useScenarioPreservingHref } from "@/hooks/use-scenario-preserving-href";

const TABS = [
  { label: "Overview", href: "overview" },
  { label: "Details", href: "client-data" },
  { label: "Assets", href: "assets" },
  { label: "Cash Flow", href: "cashflow" },
  { label: "Estate Planning", href: "estate-planning" },
  { label: "Reports", href: "reports" },
] as const;

interface TopbarProps {
  clientHouseholdTitle?: string;
}

export default function Topbar({ clientHouseholdTitle }: TopbarProps): ReactElement {
  const pathname = usePathname();
  const withScenario = useScenarioPreservingHref();
  const match = pathname.match(/^\/clients\/([^/]+)/);
  const clientId = match?.[1];

  return (
    <header className="sticky top-0 z-20 grid h-14 grid-cols-[1fr_auto_1fr] items-center border-b border-hair bg-paper px-[var(--pad-card)]">
      <div className="justify-self-start">
        <Breadcrumb clientHouseholdTitle={clientHouseholdTitle} />
      </div>
      {clientId ? (
        <nav role="tablist" className="flex items-center gap-1 justify-self-center">
          {TABS.map((tab) => {
            const href = `/clients/${clientId}/${tab.href}`;
            const active = pathname.startsWith(href);
            const className = active
              ? "inline-flex items-center rounded-md border border-accent bg-card-2 px-3 py-1.5 text-[13px] font-medium text-accent"
              : "inline-flex items-center rounded-md border border-transparent px-3 py-1.5 text-[13px] text-ink-2 hover:bg-card-2 hover:text-ink";
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
      ) : (
        <div />
      )}
      <div className="justify-self-end">
        <button
          type="button"
          disabled
          aria-disabled="true"
          title="Coming soon"
          className="inline-flex cursor-not-allowed items-center gap-2 rounded-md border border-hair bg-card-2 px-3 py-1.5 text-[13px] text-ink-3"
        >
          Client Portal
          <span className="rounded-sm bg-ink-3/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-3">
            Soon
          </span>
        </button>
      </div>
    </header>
  );
}
