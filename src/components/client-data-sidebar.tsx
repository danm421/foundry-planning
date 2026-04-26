"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface ClientDataSidebarProps {
  clientId: string;
}

interface SidebarTab {
  label: string;
  href: string;
  icon: React.ReactNode;
}

const ICON_CLASS = "h-[18px] w-[18px] flex-shrink-0";

function FamilyIcon() {
  return (
    <svg className={ICON_CLASS} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="7" r="3.2" />
      <circle cx="17" cy="8.5" r="2.2" />
      <path d="M3.5 19c.7-3.4 3-5.2 5.5-5.2s4.8 1.8 5.5 5.2" />
      <path d="M15 18.5c.4-2.5 2-3.6 3.5-3.6s3.1 1.1 3.5 3.6" />
    </svg>
  );
}

function BalanceSheetIcon() {
  return (
    <svg className={ICON_CLASS} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="5" width="16" height="14" rx="1.5" />
      <path d="M4 10h16" />
      <path d="M12 10v9" />
    </svg>
  );
}

function CashflowIcon() {
  return (
    <svg className={ICON_CLASS} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 17h4l2-10h4l2 10h4" />
      <path d="M7 20.5l1-1.5" />
      <path d="M17 20.5l-1-1.5" />
    </svg>
  );
}

function AssumptionsIcon() {
  return (
    <svg className={ICON_CLASS} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 01-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 010-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3h.1a1.7 1.7 0 001-1.5V3a2 2 0 014 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8v.1a1.7 1.7 0 001.5 1H21a2 2 0 010 4h-.1a1.7 1.7 0 00-1.5 1z" />
    </svg>
  );
}

function ImportIcon() {
  return (
    <svg className={ICON_CLASS} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function TechniquesIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 8h8M7 4l-3 4 3 4M9 4l3 4-3 4" />
    </svg>
  );
}

function WillsIcon() {
  return (
    <svg className={ICON_CLASS} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6M9 17h4" />
    </svg>
  );
}

function InsuranceIcon() {
  return (
    <svg className={ICON_CLASS} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2L4 6v6c0 5 3.5 9.3 8 10 4.5-.7 8-5 8-10V6l-8-4z" />
      <path d="M12 8v6" />
      <path d="M9 11h6" />
    </svg>
  );
}

const TABS: SidebarTab[] = [
  { label: "Family", href: "family", icon: <FamilyIcon /> },
  { label: "Wills", href: "wills", icon: <WillsIcon /> },
  { label: "Insurance", href: "insurance", icon: <InsuranceIcon /> },
  { label: "Net Worth", href: "balance-sheet", icon: <BalanceSheetIcon /> },
  { label: "Inflows & Outflows", href: "income-expenses", icon: <CashflowIcon /> },
  { label: "Techniques", href: "techniques", icon: <TechniquesIcon /> },
  { label: "Assumptions", href: "assumptions", icon: <AssumptionsIcon /> },
  { label: "Import", href: "import", icon: <ImportIcon /> },
];

export default function ClientDataSidebar({ clientId }: ClientDataSidebarProps) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-1">
      {TABS.map((tab) => {
        const href = `/clients/${clientId}/client-data/${tab.href}`;
        const isActive = pathname === href || pathname.startsWith(href + "/");
        return (
          <Link
            key={tab.href}
            href={href}
            className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
              isActive
                ? "bg-gray-800 text-gray-100"
                : "text-gray-300 hover:bg-gray-800/50 hover:text-gray-200"
            }`}
          >
            <span className={isActive ? "text-blue-400" : "text-gray-400"}>{tab.icon}</span>
            <span>{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
