import type { ReactElement } from "react";
import type { PortalArea } from "@/lib/portal/privacy";
import { LockIcon } from "@/components/portal/portal-icons";
import { PortalNoticeCard } from "@/components/portal/portal-notice-card";

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
  return (
    <PortalNoticeCard
      icon={<LockIcon className="h-5 w-5" />}
      heading="Not shared"
      variant={variant}
    >
      This client keeps their {PORTAL_AREA_LABELS[area]} private. They control
      sharing from Settings in their portal.
    </PortalNoticeCard>
  );
}
