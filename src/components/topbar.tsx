"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactElement } from "react";
import BackButton from "./back-button";
import Breadcrumb from "./breadcrumb";
import { ThemeToggle } from "./theme-toggle";
import { useScenarioPreservingHref } from "@/hooks/use-scenario-preserving-href";
import { QuickNoteButton } from "./quick-note-button";
import { NavTab, type Tab } from "./topbar-nav-tab";

// Overview is hidden for now (default planning lands on Details). The route
// still lives at /clients/[id]/overview — re-add this tab to bring it back.
const PRIMARY_TABS: ReadonlyArray<Tab> = [
  { label: "Details", href: "details" },
  { label: "Solver", href: "solver" },
  { label: "Presentations", href: "presentations" },
];

// Report groups: quieter tier, always visible, each owns a hover flyout.
// Ordered as the planning narrative — what you own, what flows, what transfers.
const SECONDARY_TABS: ReadonlyArray<Tab> = [
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
      {
        label: "Investments",
        path: "/investments",
        defaultView: "allocation",
        views: [
          { label: "Allocation", path: "/investments?view=allocation" },
          { label: "Portfolio Analysis", path: "/investments?view=analysis" },
          { label: "Rebalance", path: "/investments?view=rebalance" },
          { label: "Holdings", path: "/investments?view=holdings" },
        ],
      },
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
  // Label only — the route stays /clients/[id]/estate-planning.
  {
    label: "Estate",
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
];

// Portal is rendered separately on the right side of the header (next to the
// theme toggle) rather than grouped with the planning tabs above.
const PORTAL_TAB = { label: "Portal", href: "portal" } as const;

interface TopbarProps {
  clientHouseholdTitle?: string;
}

export default function Topbar({ clientHouseholdTitle }: TopbarProps): ReactElement {
  const pathname = usePathname();
  const withScenario = useScenarioPreservingHref();
  const match = pathname.match(/^\/clients\/([^/]+)/);
  const clientId = match?.[1];

  return (
    <header className="sticky top-0 z-40 grid h-14 grid-cols-[1fr_auto_1fr] items-center border-b border-hair bg-paper px-[var(--pad-card)]">
      <div className="flex items-center gap-2 justify-self-start">
        <BackButton />
        <Breadcrumb clientHouseholdTitle={clientHouseholdTitle} />
      </div>
      {clientId ? (
        <nav role="tablist" className="flex items-center gap-1 justify-self-center">
          {PRIMARY_TABS.map((tab) => (
            <NavTab key={tab.href} tab={tab} tier="primary" clientId={clientId} />
          ))}
          <span aria-hidden className="mx-2 h-4 w-px bg-hair" />
          {SECONDARY_TABS.map((tab) => (
            <NavTab key={tab.href} tab={tab} tier="secondary" clientId={clientId} />
          ))}
        </nav>
      ) : (
        <div />
      )}
      <div className="flex items-center gap-2 justify-self-end">
        {clientId
          ? (() => {
              const portalHref = `/clients/${clientId}/${PORTAL_TAB.href}`;
              const portalActive = pathname.startsWith(portalHref);
              const portalClassName = portalActive
                ? "inline-flex items-center rounded-md border border-accent bg-card-2 px-3 py-1.5 text-[13px] font-medium text-accent"
                : "inline-flex items-center rounded-md border border-transparent px-3 py-1.5 text-[13px] text-ink-2 hover:bg-card-2 hover:text-ink";
              return (
                <Link
                  href={withScenario(portalHref)}
                  role="tab"
                  aria-selected={portalActive || undefined}
                  className={portalClassName}
                >
                  {PORTAL_TAB.label}
                </Link>
              );
            })()
          : null}
        {clientId ? <QuickNoteButton clientId={clientId} /> : null}
        <ThemeToggle />
      </div>
    </header>
  );
}
