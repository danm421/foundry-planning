"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import { useEffect, useRef, type ReactElement } from "react";
import {
  visiblePortalNavItems,
  isPortalNavItemActive,
} from "@/components/portal/portal-nav-items";
import PortalBrandingMark, {
  type PortalBranding,
} from "@/components/portal/portal-branding-mark";
import {
  DEFAULT_PORTAL_FEATURES,
  type PortalFeatures,
} from "@/lib/portal/features";

interface Props {
  /**
   * Who the top bar greets — both halves of the household when there are two
   * ("John & Jane"), from `portalGreetingName`. Empty falls back to a generic
   * title.
   */
  displayName: string;
  /** Resolved firm branding; null → Foundry lockup (same fallback as intake). */
  branding?: PortalBranding | null;
  basePath?: string;
  /** Visibility classes from the layout (e.g. `"lg:hidden"`). */
  className?: string;
  /**
   * Keyed by nav-item `suffix`; `true` renders a small attention dot next to
   * that item's label. Absent or `false` → no dot. Defaults to `{}` so
   * standalone consumers and existing tests render unchanged.
   */
  alerts?: Record<string, boolean>;
  /**
   * Advisor-controlled section switches. Defaults to all-on so standalone
   * consumers and existing tests render the full strip.
   */
  features?: PortalFeatures;
}

/**
 * Mobile-only top navigation for the client portal. Replaces the desktop side
 * rail with a horizontally scrollable tab strip (the Copilot pattern): the user
 * flicks the strip left/right and taps a tab to navigate. The active tab
 * auto-centers on every route change. Each tab is its own route, so the back
 * button and deep links keep working. Rendered alongside `PortalNav`, which the
 * layout hides below `lg`.
 */
export default function PortalMobileNav({
  displayName,
  branding = null,
  basePath = "/portal",
  className = "",
  alerts = {},
  features = DEFAULT_PORTAL_FEATURES,
}: Props): ReactElement {
  const pathname = usePathname();
  const activeRef = useRef<HTMLAnchorElement | null>(null);
  const items = visiblePortalNavItems(features);

  // Keep the active tab centered as the route changes (and on first paint).
  useEffect(() => {
    const el = activeRef.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({
      inline: "center",
      block: "nearest",
      behavior: reduce ? "auto" : "smooth",
    });
  }, [pathname]);

  return (
    <div
      className={`sticky top-0 z-30 border-b border-hair bg-paper ${className}`.trim()}
    >
      <div className="flex items-center justify-between gap-3 px-4 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <span className="truncate text-[15px] font-semibold text-ink">
          {displayName ? `Welcome, ${displayName}` : "Your portal"}
        </span>
        <div className="flex shrink-0 items-center gap-3">
          <PortalBrandingMark
            branding={branding}
            className="h-6 max-w-[140px]"
          />
          <UserButton />
        </div>
      </div>

      <nav
        aria-label="Portal sections"
        className="flex snap-x snap-proximity gap-2 overflow-x-auto scroll-smooth px-4 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {items.map((item) => {
          const href = `${basePath}${item.suffix}`;
          const active = isPortalNavItemActive(pathname, href, item);
          return (
            <Link
              key={item.suffix}
              ref={active ? activeRef : undefined}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`inline-flex min-h-[44px] shrink-0 snap-center items-center whitespace-nowrap rounded-full border px-4 text-[14px] transition-colors ${
                active
                  ? "border-accent/50 bg-accent-wash font-medium text-accent-ink"
                  : "border-transparent text-ink-3 active:text-ink-2"
              }`}
            >
              <span className="flex items-center gap-2">
                {item.label}
                {alerts[item.suffix] && (
                  <span
                    aria-label="Needs attention"
                    className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-warn"
                  />
                )}
              </span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
