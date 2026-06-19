"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import type { ReactElement } from "react";

const SECTIONS = [
  {
    label: "Profile",
    items: [
      { label: "Household", href: "/portal/profile" },
      { label: "Family", href: "/portal/profile/family" },
      { label: "Trusts", href: "/portal/profile/trusts" },
    ],
  },
  // Accounts arrives in Plan 2; intentionally absent in Plan 1.
] as const;

interface Props {
  displayName: string;
  email: string;
}

export default function PortalNav({ displayName, email }: Props): ReactElement {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-2 p-5 bg-card-2 border-r border-hair">
      <header className="mb-4">
        <div className="text-[14px] font-semibold text-ink">{displayName}</div>
        <div className="text-[12px] text-ink-3 truncate">{email}</div>
      </header>

      {SECTIONS.map((section) => (
        <div key={section.label} className="mb-3">
          <div className="text-[11px] uppercase tracking-wide text-ink-3 mb-1">
            {section.label}
          </div>
          <ul className="space-y-0.5">
            {section.items.map((item) => {
              const active = pathname === item.href;
              const cls = active
                ? "block rounded-md bg-accent/20 text-accent px-3 py-1.5 text-[13px] font-medium"
                : "block rounded-md text-ink-2 hover:bg-card hover:text-ink px-3 py-1.5 text-[13px]";
              return (
                <li key={item.href}>
                  <Link href={item.href} className={cls}>
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      <div className="mt-auto pt-4 border-t border-hair flex items-center gap-2">
        <UserButton />
        <span className="text-[12px] text-ink-3">Sign out via menu</span>
      </div>
    </nav>
  );
}
