"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import type { ReactElement } from "react";

// Accounts: Phase 2 — intentionally absent here.
const ITEMS = [
  { label: "Household", suffix: "/profile" },
  { label: "Family", suffix: "/profile/family" },
  { label: "Trusts", suffix: "/profile/trusts" },
] as const;

interface Props {
  displayName: string;
  email: string;
  basePath?: string;
}

export default function PortalNav({
  displayName,
  email,
  basePath = "/portal",
}: Props): ReactElement {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-2 border-r border-hair bg-card-2 p-5">
      <header className="mb-4">
        <div className="text-[14px] font-semibold text-ink">{displayName}</div>
        <div className="truncate text-[12px] text-ink-3">{email}</div>
      </header>

      <div className="mb-3">
        <div className="mb-1 text-[11px] uppercase tracking-wide text-ink-3">
          Profile
        </div>
        <ul className="space-y-0.5">
          {ITEMS.map((item) => {
            const href = `${basePath}${item.suffix}`;
            const active = pathname === href;
            const cls = active
              ? "block rounded-md bg-accent/20 px-3 py-1.5 text-[13px] font-medium text-accent"
              : "block rounded-md px-3 py-1.5 text-[13px] text-ink-2 hover:bg-card hover:text-ink";
            return (
              <li key={item.suffix}>
                <Link href={href} className={cls}>
                  {item.label}
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
