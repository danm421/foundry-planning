"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState, type ReactElement } from "react";
import { useScenarioPreservingHref } from "@/hooks/use-scenario-preserving-href";
import { ChevronRightIcon } from "./icons";

/** A `view` is the third tier: an alternate presentation within one sub-report. */
export type View = { label: string; path: string };

export type SubTab = {
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

export type Tab = {
  label: string;
  href: string;
  subTabs?: ReadonlyArray<SubTab>;
};

export function NavTab({ tab, clientId }: { tab: Tab; clientId: string }): ReactElement {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const withScenario = useScenarioPreservingHref();
  const [dismissed, setDismissed] = useState(false);

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
          setDismissed(true);
          e.currentTarget.blur();
        }
      }}
    >
      {tab.label}
    </Link>
  );

  if (!tab.subTabs) {
    return <div>{tabLink}</div>;
  }

  const menuClassName = dismissed
    ? "invisible absolute left-1/2 top-full z-30 -translate-x-1/2 pt-1 opacity-0"
    : "invisible absolute left-1/2 top-full z-30 -translate-x-1/2 pt-1 opacity-0 transition-opacity duration-100 group-hover/tab:visible group-hover/tab:opacity-100 group-focus-within/tab:visible group-focus-within/tab:opacity-100";

  return (
    <div className="group/tab relative" onMouseLeave={() => setDismissed(false)}>
      {tabLink}
      <div role="menu" aria-label={`${tab.label} sections`} className={menuClassName}>
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
                      setDismissed(true);
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
                              setDismissed(true);
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
                  setDismissed(true);
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
}
