"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactElement } from "react";
import Breadcrumb from "./breadcrumb";
import { useScenarioPreservingHref } from "@/hooks/use-scenario-preserving-href";

type SubTab = { label: string; path: string };

const TABS: ReadonlyArray<{
  label: string;
  href: string;
  subTabs?: ReadonlyArray<SubTab>;
}> = [
  { label: "Overview", href: "overview" },
  { label: "Details", href: "client-data" },
  {
    label: "Assets",
    href: "assets",
    subTabs: [
      { label: "Balance Sheet", path: "/balance-sheet-report" },
      { label: "Investments", path: "/investments" },
    ],
  },
  {
    label: "Cash Flow",
    href: "cashflow",
    subTabs: [
      { label: "Cash Flow", path: "" },
      { label: "Income Tax", path: "/income-tax" },
      { label: "Monte Carlo", path: "/monte-carlo" },
      { label: "Timeline", path: "/timeline" },
      { label: "Entities", path: "/entities" },
    ],
  },
  { label: "Solver", href: "solver" },
  {
    label: "Estate Planning",
    href: "estate-planning",
    subTabs: [
      { label: "Planning", path: "" },
      { label: "Estate Tax", path: "/estate-tax" },
      { label: "Estate Transfer", path: "/estate-transfer" },
      { label: "Estate Flow", path: "/estate-flow" },
      { label: "Liquidity", path: "/liquidity" },
      { label: "Gift Tax", path: "/gift-tax" },
    ],
  },
  { label: "Comparison", href: "comparison" },
];

interface TopbarProps {
  clientHouseholdTitle?: string;
}

export default function Topbar({ clientHouseholdTitle }: TopbarProps): ReactElement {
  const pathname = usePathname();
  const withScenario = useScenarioPreservingHref();
  const match = pathname.match(/^\/clients\/([^/]+)/);
  const clientId = match?.[1];
  const [dismissedTab, setDismissedTab] = useState<string | null>(null);

  return (
    <header className="sticky top-0 z-40 grid h-14 grid-cols-[1fr_auto_1fr] items-center border-b border-hair bg-paper px-[var(--pad-card)]">
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
            const tabLink = (
              <Link
                href={withScenario(href)}
                role="tab"
                aria-selected={active || undefined}
                aria-haspopup={tab.subTabs ? "menu" : undefined}
                className={className}
                onClick={(e) => {
                  if (tab.subTabs) {
                    setDismissedTab(tab.href);
                    e.currentTarget.blur();
                  }
                }}
              >
                {tab.label}
              </Link>
            );

            if (!tab.subTabs) {
              return <div key={tab.href}>{tabLink}</div>;
            }

            const dismissed = dismissedTab === tab.href;
            const menuClassName = dismissed
              ? "invisible absolute left-1/2 top-full z-30 -translate-x-1/2 pt-1 opacity-0"
              : "invisible absolute left-1/2 top-full z-30 -translate-x-1/2 pt-1 opacity-0 transition-opacity duration-100 group-hover/tab:visible group-hover/tab:opacity-100 group-focus-within/tab:visible group-focus-within/tab:opacity-100";
            return (
              <div
                key={tab.href}
                className="group/tab relative"
                onMouseLeave={() => setDismissedTab((prev) => (prev === tab.href ? null : prev))}
              >
                {tabLink}
                <div
                  role="menu"
                  aria-label={`${tab.label} sections`}
                  className={menuClassName}
                >
                  <div className="min-w-[160px] rounded-md border border-hair bg-paper py-1 shadow-lg">
                    {tab.subTabs.map((sub) => {
                      const subHref = `${href}${sub.path}`;
                      const subActive = sub.path
                        ? pathname === subHref || pathname.startsWith(subHref + "/")
                        : pathname === href;
                      const subClassName = subActive
                        ? "block px-3 py-1.5 text-[12px] font-medium text-accent bg-card-2"
                        : "block px-3 py-1.5 text-[12px] text-ink-2 hover:bg-card-2 hover:text-ink";
                      return (
                        <Link
                          key={subHref}
                          href={withScenario(subHref)}
                          role="menuitem"
                          className={`${subClassName} whitespace-nowrap`}
                          onClick={(e) => {
                            setDismissedTab(tab.href);
                            e.currentTarget.blur();
                          }}
                        >
                          {sub.label}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              </div>
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
