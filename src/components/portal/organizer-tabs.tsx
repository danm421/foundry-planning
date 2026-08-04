"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactElement } from "react";

/**
 * The Organizer section's own top-level navigation. Household, Family, Trusts
 * and Accounts used to be four siblings in the portal's left rail; they are now
 * one rail entry ("Organizer") whose tabs live here — Family and Trusts folded
 * into the Household tab as page sections.
 *
 * Each tab is its own route, so deep links and the back button keep working.
 * `suffix` is appended to `<basePath>/organizer` exactly as `BUDGET_TABS`
 * appends to `<basePath>/budget`; the advisor preview passes its own prefix.
 *
 * Four tabs, not six: `portal-mobile-nav` is itself a horizontally scrolling
 * strip, and a six-tab strip under a six-entry one puts two competing scroll
 * affordances on the same screen.
 */
export const ORGANIZER_TABS = [
  { label: "Household", suffix: "" },
  { label: "Accounts", suffix: "/accounts" },
  { label: "Goals", suffix: "/goals" },
  { label: "Cash Flow", suffix: "/cash-flow" },
] as const;

export default function OrganizerTabs({
  basePath = "/portal",
}: {
  basePath?: string;
}): ReactElement {
  const pathname = usePathname();
  const root = `${basePath}/organizer`;

  return (
    <div className="border-b border-hair px-5 py-2.5">
      <nav aria-label="Organizer sections" className="flex gap-1">
        {ORGANIZER_TABS.map((tab) => {
          const href = `${root}${tab.suffix}`;
          // Every tab is a leaf route, so exact matching is enough — no tab is
          // a prefix of another's children.
          const active = pathname === href;
          return (
            <Link
              key={tab.suffix || "organizer"}
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
