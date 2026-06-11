"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState, type ReactElement } from "react";
import BackButton from "./back-button";
import Breadcrumb from "./breadcrumb";
import { ThemeToggle } from "./theme-toggle";
import { useScenarioPreservingHref } from "@/hooks/use-scenario-preserving-href";
import { ChevronRightIcon } from "./icons";

/** A `view` is the third tier: an alternate presentation within one sub-report. */
type View = { label: string; path: string };
type SubTab = {
  label: string;
  path: string;
  views?: ReadonlyArray<View>;
  /**
   * For query-param views (`?view=…`), the view id shown when the param is
   * absent — so the default view highlights on the bare report URL. Omit for
   * route-based views (Ledgers), which are distinguished by pathname alone.
   */
  defaultView?: string;
};

const TABS: ReadonlyArray<{
  label: string;
  href: string;
  subTabs?: ReadonlyArray<SubTab>;
}> = [
  // Overview is hidden for now (default planning lands on Details). The route
  // still lives at /clients/[id]/overview — re-add this tab to bring it back.
  { label: "Details", href: "details" },
  {
    label: "Assets",
    href: "assets",
    subTabs: [
      {
        label: "Balance Sheet",
        path: "/balance-sheet-report",
        defaultView: "household",
        views: [
          { label: "Household", path: "/balance-sheet-report?view=household" },
          { label: "By Entity", path: "/balance-sheet-report?view=entities" },
        ],
      },
      { label: "Investments", path: "/investments" },
    ],
  },
  {
    label: "Cash Flow",
    href: "cashflow",
    subTabs: [
      { label: "Cash Flow", path: "" },
      {
        label: "Income Tax",
        path: "/income-tax",
        defaultView: "income",
        views: [
          { label: "Income Breakdown", path: "/income-tax?view=income" },
          { label: "Federal Tax Breakdown", path: "/income-tax?view=federal" },
          { label: "State Tax Breakdown", path: "/income-tax?view=state" },
          { label: "Tax Bracket", path: "/income-tax?view=bracket" },
          { label: "Medicare & IRMAA", path: "/income-tax?view=medicare" },
        ],
      },
      {
        label: "Ledgers",
        path: "/ledgers",
        views: [
          { label: "Asset Ledger", path: "/ledgers/asset-ledger" },
          { label: "Tax Ledger", path: "/ledgers/tax-ledger" },
        ],
      },
      { label: "Monte Carlo", path: "/monte-carlo" },
      { label: "Timeline", path: "/timeline" },
      { label: "Entities", path: "/entities" },
      {
        label: "Stock Options",
        path: "/stock-options",
        defaultView: "vesting",
        views: [
          { label: "Vesting Schedule", path: "/stock-options?view=vesting" },
          { label: "Future Activity", path: "/stock-options?view=activity" },
          { label: "Tax Impact", path: "/stock-options?view=tax-impact" },
        ],
      },
    ],
  },
  { label: "Solver", href: "solver" },
  {
    label: "Estate Planning",
    href: "estate-planning",
    subTabs: [
      {
        label: "Estate Flow",
        path: "/estate-flow",
        defaultView: "report",
        views: [
          { label: "Report", path: "/estate-flow?view=report" },
          { label: "Flow Chart", path: "/estate-flow?view=chart" },
          { label: "Comparison", path: "/estate-flow?view=comparison" },
        ],
      },
      {
        label: "Estate Tax",
        path: "/estate-tax",
        defaultView: "estate",
        views: [
          { label: "Estate Tax", path: "/estate-tax?view=estate" },
          { label: "State Death Tax", path: "/estate-tax?view=state" },
        ],
      },
      {
        label: "Estate Transfer",
        path: "/estate-transfer",
        defaultView: "yearly",
        views: [
          { label: "Year-by-Year", path: "/estate-transfer?view=yearly" },
          { label: "Transfer Detail", path: "/estate-transfer?view=transfers" },
        ],
      },
      { label: "Liquidity", path: "/liquidity" },
      { label: "Gift Tax", path: "/gift-tax" },
    ],
  },
  { label: "Presentations", href: "presentations" },
];

interface TopbarProps {
  clientHouseholdTitle?: string;
}

export default function Topbar({ clientHouseholdTitle }: TopbarProps): ReactElement {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const withScenario = useScenarioPreservingHref();
  const match = pathname.match(/^\/clients\/([^/]+)/);
  const clientId = match?.[1];
  const [dismissedTab, setDismissedTab] = useState<string | null>(null);

  return (
    <header className="sticky top-0 z-40 grid h-14 grid-cols-[1fr_auto_1fr] items-center border-b border-hair bg-paper px-[var(--pad-card)]">
      <div className="flex items-center gap-2 justify-self-start">
        <BackButton />
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

                      // Sub-reports with their own views get a nested flyout to the
                      // right; the sub-report link itself stays navigable.
                      if (sub.views) {
                        const triggerClassName = subActive
                          ? "flex items-center justify-between gap-3 px-3 py-1.5 text-[12px] font-medium text-accent bg-card-2"
                          : "flex items-center justify-between gap-3 px-3 py-1.5 text-[12px] text-ink-2 hover:bg-card-2 hover:text-ink";
                        return (
                          <div key={subHref} className="group/view relative">
                            <Link
                              href={withScenario(subHref)}
                              role="menuitem"
                              aria-haspopup="menu"
                              className={`${triggerClassName} whitespace-nowrap`}
                              onClick={(e) => {
                                setDismissedTab(tab.href);
                                e.currentTarget.blur();
                              }}
                            >
                              {sub.label}
                              <ChevronRightIcon width={14} height={14} className="text-ink-3" />
                            </Link>
                            <div
                              role="menu"
                              aria-label={`${sub.label} views`}
                              className="invisible absolute left-full top-0 z-30 pl-1 opacity-0 transition-opacity duration-100 group-hover/view:visible group-hover/view:opacity-100 group-focus-within/view:visible group-focus-within/view:opacity-100"
                            >
                              <div className="min-w-[150px] rounded-md border border-hair bg-paper py-1 shadow-lg">
                                {sub.views.map((view) => {
                                  const viewHref = `${href}${view.path}`;
                                  const [viewPath, viewQuery] = view.path.split("?");
                                  const viewBase = `${href}${viewPath}`;
                                  const onViewBase =
                                    pathname === viewBase || pathname.startsWith(viewBase + "/");
                                  const viewId = viewQuery
                                    ? new URLSearchParams(viewQuery).get("view")
                                    : null;
                                  // Query-param views (e.g. Income Tax → Federal) share the
                                  // report's pathname and are told apart by `?view=`; an absent
                                  // param resolves to the sub-report's `defaultView`. Route-based
                                  // views (Ledgers) are told apart by pathname alone.
                                  const viewActive = viewId
                                    ? onViewBase &&
                                      (searchParams.get("view") ?? sub.defaultView) === viewId
                                    : onViewBase;
                                  const viewClassName = viewActive
                                    ? "block px-3 py-1.5 text-[12px] font-medium text-accent bg-card-2"
                                    : "block px-3 py-1.5 text-[12px] text-ink-2 hover:bg-card-2 hover:text-ink";
                                  return (
                                    <Link
                                      key={viewHref}
                                      href={withScenario(viewHref)}
                                      role="menuitem"
                                      className={`${viewClassName} whitespace-nowrap`}
                                      onClick={(e) => {
                                        setDismissedTab(tab.href);
                                        e.currentTarget.blur();
                                      }}
                                    >
                                      {view.label}
                                    </Link>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                        );
                      }

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
      <div className="flex items-center gap-2 justify-self-end">
        <ThemeToggle />
        {clientId ? (
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
        ) : null}
      </div>
    </header>
  );
}
