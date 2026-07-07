import type { ReactElement } from "react";
import type { PortalArea } from "@/lib/portal/privacy";
import { LockIcon } from "@/components/portal/portal-icons";

/**
 * User-facing names for the gated portal areas. Lives here (not in
 * lib/portal/privacy.ts, which imports the db) so client components can use it.
 */
export const PORTAL_AREA_LABELS: Record<PortalArea, string> = {
  transactions: "transactions",
  budgets: "budget",
  recurrings: "recurring bills",
};

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
  const label = PORTAL_AREA_LABELS[area];
  const body = (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 shrink-0 text-ink-4">
        <LockIcon className="h-5 w-5" />
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
