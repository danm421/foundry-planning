import type { ReactElement } from "react";
import { portalFeatureLabel, type PortalFeatureKey } from "@/lib/portal/features";
import { SlidersIcon } from "@/components/portal/portal-icons";
import { PortalNoticeCard } from "@/components/portal/portal-notice-card";

/**
 * Stands in for a portal section the advisor has switched off.
 *
 * Replaces the bare `notFound()` these routes used to throw: the section is
 * reachable by a bookmark, a stale mobile link or a browser autocomplete long
 * after it leaves the rail, and a default 404 tells the client their portal is
 * broken rather than that it is smaller than it was.
 *
 * The sibling of `NotSharedNotice`, which is the opposite direction — the
 * *client* hiding data from the *advisor*. Different audience, different fix,
 * so they stay separate components over one shared card.
 */
export function PortalFeatureOffNotice({
  feature,
  viewer,
}: {
  feature: PortalFeatureKey;
  /** "client" — their own portal. "advisor" — the act-as-client preview. */
  viewer: "client" | "advisor";
}): ReactElement {
  const label = portalFeatureLabel(feature);
  return (
    <PortalNoticeCard
      icon={<SlidersIcon className="h-5 w-5" />}
      heading={viewer === "advisor" ? "Switched off" : "Not part of your portal"}
    >
      {viewer === "advisor"
        ? `You have ${label} switched off for this client, so it is not in their portal. Turn it back on under Manage Portal → Features.`
        : `Your advisor has not turned on ${label} for your portal. Ask them if you would like access.`}
    </PortalNoticeCard>
  );
}
