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
          ? "border-blue-600 text-blue-600"
          : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"
      }`}
    >
      {tab.label}
    </Link>
  );
}
