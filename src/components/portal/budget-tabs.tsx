"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactElement } from "react";

/**
 * The Budget section's own top-level navigation. Budget, Transactions and
 * Recurring used to be three siblings in the portal's left rail; they are now
 * one rail entry ("Budget") whose three tabs live here.
 *
 * Each tab is its own route, so deep links and the back button keep working.
 * `suffix` is appended to `<basePath>/budget` the same way `PORTAL_NAV_ITEMS`
 * appends to `basePath` — the advisor preview passes its own prefix.
 */
export const BUDGET_TABS = [
  { label: "Budget", suffix: "" },
  { label: "Transactions", suffix: "/transactions" },
  { label: "Recurring", suffix: "/recurring" },
] as const;

export default function BudgetTabs({
  basePath = "/portal",
}: {
  basePath?: string;
}): ReactElement {
  const pathname = usePathname();
  const root = `${basePath}/budget`;

  return (
    <div className="border-b border-hair px-5 py-2.5">
      <nav aria-label="Budget sections" className="flex gap-1">
        {BUDGET_TABS.map((tab) => {
          const href = `${root}${tab.suffix}`;
          // Every tab is a leaf route, so exact matching is enough — no tab is
          // a prefix of another's children.
          const active = pathname === href;
          return (
            <Link
              key={tab.suffix || "budget"}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`inline-flex min-h-[44px] items-center whitespace-nowrap rounded-full border px-3.5 text-[13px] transition-colors lg:min-h-[34px] ${
                active
                  ? "border-accent/50 bg-accent-wash font-medium text-accent-ink"
                  : "border-transparent text-ink-3 hover:bg-card hover:text-ink"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
