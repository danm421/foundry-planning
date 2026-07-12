"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useScenarioPreservingHref } from "@/hooks/use-scenario-preserving-href";
import { qsStepLabel } from "@/lib/quick-start/state";
import type { QsStepSlug } from "@/lib/quick-start/steps";
import { useClientAccess } from "./client-access-provider";

interface DetailsSidebarProps {
  clientId: string;
  quickStartResumeStep?: QsStepSlug | null;
}

interface SidebarTab {
  label: string;
  href: string;
  icon: React.ReactNode;
}

const ICON_CLASS = "h-[18px] w-[18px] flex-shrink-0";

function ProfileIcon() {
  return (
    <svg className={ICON_CLASS} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="7" r="3.2" />
      <circle cx="17" cy="8.5" r="2.2" />
      <path d="M3.5 19c.7-3.4 3-5.2 5.5-5.2s4.8 1.8 5.5 5.2" />
      <path d="M15 18.5c.4-2.5 2-3.6 3.5-3.6s3.1 1.1 3.5 3.6" />
    </svg>
  );
}

function ObservationsIcon() {
  return (
    <svg className={ICON_CLASS} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="6" y="4" width="12" height="16" rx="1.5" />
      <path d="M9 4V3.2A1.2 1.2 0 0 1 10.2 2h3.6A1.2 1.2 0 0 1 15 3.2V4" />
      <path d="M9 12.5l2 2 3.5-4" />
    </svg>
  );
}

function NetWorthIcon() {
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

function TaxAnalysisIcon() {
  return (
    <svg className={ICON_CLASS} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M14 3v5h5" />
      <path d="M9 18v-3M12 18v-5M15 18v-2" />
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
  { label: "Profile", href: "family", icon: <ProfileIcon /> },
  { label: "Observations", href: "observations", icon: <ObservationsIcon /> },
  { label: "Net Worth", href: "net-worth", icon: <NetWorthIcon /> },
  { label: "Inflows & Outflows", href: "income-expenses", icon: <CashflowIcon /> },
  { label: "Insurance", href: "insurance", icon: <InsuranceIcon /> },
  { label: "Techniques", href: "techniques", icon: <TechniquesIcon /> },
  { label: "Wills", href: "wills", icon: <WillsIcon /> },
  { label: "Assumptions", href: "assumptions", icon: <AssumptionsIcon /> },
];

const IMPORT_TAB: SidebarTab = { label: "Import", href: "import", icon: <ImportIcon /> };
const TAX_ANALYSIS_TAB: SidebarTab = {
  label: "Tax Analysis",
  href: "tax-analysis",
  icon: <TaxAnalysisIcon />,
};

function GuidedWalkthroughMenu({
  clientId,
  resumeStep,
  withScenario,
}: {
  clientId: string;
  resumeStep: QsStepSlug | null;
  withScenario: (href: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Close on outside-click and Escape — mirrors client-identity-menu.tsx.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const quickHref = `/clients/${clientId}/quick-start?step=${resumeStep ?? "income"}`;
  const quickLabel = resumeStep
    ? `Resume Quick Start · ${qsStepLabel(resumeStep)}`
    : "Quick Start";

  return (
    <div ref={wrapperRef} className="relative mt-3">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 rounded-md border border-dashed border-gray-700 px-3 py-2 text-sm font-medium text-gray-300 hover:bg-gray-800"
      >
        <svg className="h-[18px] w-[18px] flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 5h16M4 12h16M4 19h10" />
          <circle cx="20" cy="19" r="2" />
        </svg>
        <span className="flex-1 text-left">Guided Walkthrough</span>
        <span aria-hidden="true" className={`text-[10px] transition-transform ${open ? "rotate-180" : ""}`}>
          ▾
        </span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute top-full left-0 z-40 mt-1.5 w-full rounded-xl border border-hair bg-paper p-1.5 shadow-lg"
        >
          <Link
            role="menuitem"
            href={quickHref}
            onClick={() => setOpen(false)}
            className="block rounded-md px-3 py-2 text-[13px] font-medium text-ink hover:bg-card-2"
          >
            {quickLabel}
          </Link>
          <Link
            role="menuitem"
            href={withScenario(`/clients/${clientId}/onboarding`)}
            onClick={() => setOpen(false)}
            className="block rounded-md px-3 py-2 text-[13px] font-medium text-ink hover:bg-card-2"
          >
            Detailed setup
          </Link>
        </div>
      )}
    </div>
  );
}

export default function DetailsSidebar({ clientId, quickStartResumeStep = null }: DetailsSidebarProps) {
  const pathname = usePathname();
  const withScenario = useScenarioPreservingHref();
  const { access } = useClientAccess();

  function renderLink(tab: SidebarTab) {
    const href = `/clients/${clientId}/details/${tab.href}`;
    const isActive = pathname === href || pathname.startsWith(href + "/");
    return (
      <Link
        key={tab.href}
        href={withScenario(href)}
        className={`flex items-center gap-3 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
          isActive
            ? "border-accent bg-card-2 text-accent"
            : "border-transparent text-gray-300 hover:bg-card-2 hover:text-gray-200"
        }`}
      >
        <span className={isActive ? "text-accent" : "text-gray-400"}>{tab.icon}</span>
        <span>{tab.label}</span>
      </Link>
    );
  }

  return (
    <nav className="flex flex-col gap-1">
      {TABS.map(renderLink)}
      {access === "own" && (
        <div className="mt-2 flex flex-col gap-1 border-t border-gray-800 pt-3">
          {renderLink(IMPORT_TAB)}
          {renderLink(TAX_ANALYSIS_TAB)}
        </div>
      )}
      <GuidedWalkthroughMenu
        clientId={clientId}
        resumeStep={quickStartResumeStep}
        withScenario={withScenario}
      />
    </nav>
  );
}
