"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactElement } from "react";

/** One tab. `suffix` is appended to the strip's `root`; `""` is the section index. */
export interface PortalTab {
  label: string;
  suffix: string;
}

/**
 * The pill's colour scheme. Exported because the account drawer's in-panel tabs
 * wear the same pill at a different size — sharing the colours here is what
 * keeps a restyle from landing on the section strips and missing the drawer.
 */
export function portalTabColors(active: boolean): string {
  return active
    ? "border-accent/50 bg-accent-wash font-medium text-accent-ink"
    : "border-transparent text-ink-3 hover:text-ink";
}

/**
 * The portal's section-level tab strip — the pill row that sits under the
 * branding strip and above a section's content.
 *
 * One component, two strips: Organizer (`organizer-tabs.tsx`) and Budget
 * (`budget-tabs.tsx`) render the same markup with different tab lists, and a
 * client can see both on the same rail. Keeping the pill styling here means a
 * restyle cannot land on one strip and miss the other.
 *
 * `root` already carries the caller's basePath, so the advisor preview's
 * `/clients/:id/portal/preview` prefix needs no special case here.
 */
export default function PortalTabStrip({
  root,
  tabs,
  label,
}: {
  root: string;
  tabs: readonly PortalTab[];
  label: string;
}): ReactElement {
  const pathname = usePathname();

  return (
    <div className="border-b border-hair px-5 py-2.5">
      <nav aria-label={label} className="flex gap-1">
        {tabs.map((tab) => {
          const href = `${root}${tab.suffix}`;
          // Every tab is a leaf route, so exact matching is enough — no tab is
          // a prefix of another's children.
          const active = pathname === href;
          return (
            <Link
              key={tab.suffix || root}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`inline-flex min-h-[44px] items-center whitespace-nowrap rounded-full border px-3.5 text-[13px] transition-colors lg:min-h-[34px] ${portalTabColors(
                active,
              )} ${active ? "" : "hover:bg-card"}`}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
