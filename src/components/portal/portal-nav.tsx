"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import type { ReactElement } from "react";
import {
  PORTAL_NAV_ITEMS,
  type PortalNavItem,
} from "@/components/portal/portal-nav-items";

const OVERVIEW_ITEMS = PORTAL_NAV_ITEMS.filter((i) => i.group === "overview");
const PROFILE_ITEMS = PORTAL_NAV_ITEMS.filter((i) => i.group === "profile");
const MONEY_ITEMS = PORTAL_NAV_ITEMS.filter((i) => i.group === "money");
const SETTINGS_ITEMS = PORTAL_NAV_ITEMS.filter((i) => i.group === "settings");

interface Props {
  displayName: string;
  email: string;
  basePath?: string;
  /**
   * Display + visibility classes for the root <nav>. Defaults to `"flex"` so
   * standalone consumers (advisor preview, tests) render unchanged. The client
   * portal layout passes `"hidden lg:flex"` to make this a desktop-only rail —
   * the base class list intentionally omits `flex` so that override wins.
   */
  className?: string;
  /**
   * Keyed by nav-item `suffix`; `true` renders a small attention dot next to
   * that item's label. Absent or `false` → no dot. Defaults to `{}` so
   * standalone consumers and existing tests render unchanged.
   */
  alerts?: Record<string, boolean>;
}

export default function PortalNav({
  displayName,
  email,
  basePath = "/portal",
  className = "flex",
  alerts = {},
}: Props): ReactElement {
  const pathname = usePathname();
  function itemCls(active: boolean): string {
    return active
      ? "block rounded-md bg-accent/20 px-3 py-1.5 text-[13px] font-medium text-accent"
      : "block rounded-md px-3 py-1.5 text-[13px] text-ink-2 hover:bg-card hover:text-ink";
  }
  function itemLabel(item: PortalNavItem): ReactElement {
    return (
      <span className="flex items-center gap-2">
        {item.label}
        {alerts[item.suffix] && (
          <span
            aria-label="Needs attention"
            className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-warn"
          />
        )}
      </span>
    );
  }
  return (
    <nav
      className={`${className} flex-col gap-2 border-r border-hair bg-card-2 p-5`}
    >
      <header className="mb-4">
        <div className="text-[14px] font-semibold text-ink">{displayName}</div>
        <div className="truncate text-[12px] text-ink-3">{email}</div>
      </header>

      <div className="mb-3">
        <ul className="space-y-0.5">
          {OVERVIEW_ITEMS.map((item) => {
            const href = `${basePath}${item.suffix}`;
            return (
              <li key={item.suffix || "dashboard"}>
                <Link href={href} className={itemCls(pathname === href)}>
                  {itemLabel(item)}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="mb-3">
        <div className="mb-1 text-[11px] uppercase tracking-wide text-ink-3">
          Profile
        </div>
        <ul className="space-y-0.5">
          {PROFILE_ITEMS.map((item) => {
            const href = `${basePath}${item.suffix}`;
            return (
              <li key={item.suffix}>
                <Link href={href} className={itemCls(pathname === href)}>
                  {itemLabel(item)}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="mb-3">
        <ul className="space-y-0.5">
          {MONEY_ITEMS.map((item) => {
            const href = `${basePath}${item.suffix}`;
            return (
              <li key={item.suffix}>
                <Link href={href} className={itemCls(pathname === href)}>
                  {itemLabel(item)}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="mb-3">
        <ul className="space-y-0.5">
          {SETTINGS_ITEMS.map((item) => {
            const href = `${basePath}${item.suffix}`;
            return (
              <li key={item.suffix}>
                <Link href={href} className={itemCls(pathname === href)}>
                  {itemLabel(item)}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="mt-auto flex items-center gap-2 border-t border-hair pt-4">
        <UserButton />
        <span className="text-[12px] text-ink-3">Sign out via menu</span>
      </div>
    </nav>
  );
}
