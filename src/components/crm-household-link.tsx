import Link from "next/link";
import type { ReactElement } from "react";

// Inline Lucide-style book-user icon (strokeWidth 1.5, currentColor) — the
// repo deliberately has no icon-library dependency.
function CrmIcon(): ReactElement {
  return (
    <svg
      className="h-3.5 w-3.5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
      <circle cx="12" cy="8" r="2.5" />
      <path d="M8.5 14.5a3.5 3.5 0 0 1 7 0" />
    </svg>
  );
}

/** Header shortcut from a planning client to its CRM household record. */
export default function CrmHouseholdLink({
  crmHouseholdId,
}: {
  crmHouseholdId: string;
}): ReactElement {
  return (
    <Link
      href={`/crm/households/${crmHouseholdId}`}
      aria-label="Open CRM household"
      className="btn-ghost flex items-center gap-1.5 h-8 px-3 text-[13px] font-medium"
    >
      <CrmIcon />
      CRM
    </Link>
  );
}
