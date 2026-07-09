"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import { useEffect, useRef, type ReactElement } from "react";
import { PORTAL_NAV_ITEMS } from "@/components/portal/portal-nav-items";
import PortalBrandingMark, {
  type PortalBranding,
} from "@/components/portal/portal-branding-mark";

interface Props {
  displayName: string;
  /** Resolved firm branding; null → Foundry lockup (same fallback as intake). */
  branding?: PortalBranding | null;
  basePath?: string;
  /** Visibility classes from the layout (e.g. `"lg:hidden"`). */
  className?: string;
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
}: Props): ReactElement {
  const pathname = usePathname();
  const activeRef = useRef<HTMLAnchorElement | null>(null);

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
          {displayName || "Your portal"}
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
        {PORTAL_NAV_ITEMS.map((item) => {
          const href = `${basePath}${item.suffix}`;
          const active = pathname === href;
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
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
