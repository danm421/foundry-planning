import type { ReactElement } from "react";
import type { PortalArea } from "@/lib/portal/privacy";

const AREA_LABELS: Record<PortalArea, string> = {
  transactions: "transactions",
  budgets: "budget",
  recurrings: "recurring bills",
};

function LockIcon(): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect width="18" height="11" x="3" y="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

/**
 * Advisor-preview placeholder for a portal area the client has switched off in
 * Portal → Settings. `variant="page"` fills a section route; `variant="tile"`
 * sits in the dashboard grid where a data tile would.
 */
export function NotSharedNotice({
  area,
  variant = "page",
}: {
  area: PortalArea;
  variant?: "page" | "tile";
}): ReactElement {
  const label = AREA_LABELS[area];
  const body = (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 shrink-0 text-ink-4">
        <LockIcon />
      </span>
      <div className="space-y-1">
        <h2 className="text-[15px] font-semibold text-ink">Not shared</h2>
        <p className="text-[13px] leading-relaxed text-ink-3">
          This client keeps their {label} private. They control sharing from
          Settings in their portal.
        </p>
      </div>
    </div>
  );
  if (variant === "tile") {
    return <section className="rounded-xl border border-hair bg-card p-5">{body}</section>;
  }
  return (
    <div className="p-6 lg:p-10">
      <div className="max-w-md rounded-xl border border-hair bg-card p-6">{body}</div>
    </div>
  );
}
