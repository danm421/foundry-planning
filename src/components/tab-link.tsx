"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface TabLinkProps {
  clientId: string;
  tab: { label: string; href: string };
}

export default function TabLink({ clientId, tab }: TabLinkProps) {
  const pathname = usePathname();
  const href = `/clients/${clientId}/${tab.href}`;
  const isActive = pathname === href || pathname.startsWith(href + "/");

  return (
    <Link
      href={href}
      className={`whitespace-nowrap border-b-2 pb-3 text-sm font-medium transition-colors ${
        isActive
          ? "border-blue-500 text-blue-500"
          : "border-transparent text-gray-400 hover:border-gray-600 hover:text-gray-200"
      }`}
    >
      {tab.label}
    </Link>
  );
}
