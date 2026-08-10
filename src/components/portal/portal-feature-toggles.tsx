"use client";

import { useState, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import PortalCard from "@/components/portal/portal-card";
import { SlidersIcon } from "@/components/portal/portal-icons";
import { SwitchControl } from "@/components/forms/switch-control";
import {
  PORTAL_FEATURE_META,
  type PortalFeatureKey,
  type PortalFeatures,
} from "@/lib/portal/features";

interface Props {
  clientId: string;
  initialFeatures: PortalFeatures;
}

/**
 * Advisor-side switches for the optional portal sections. Off removes the
 * section from the client's rail and mobile tab strip, drops the dashboard
 * tiles that link into it, and 404s the route.
 *
 * Optimistic like `PortalEditToggle`: flip, PUT, revert on failure. Each row
 * PUTs only its own feature, so two quick flips can't clobber each other.
 */
export default function PortalFeatureToggles({
  clientId,
  initialFeatures,
}: Props): ReactElement {
  const router = useRouter();
  const [features, setFeatures] = useState(initialFeatures);
  const [busy, setBusy] = useState<PortalFeatureKey | null>(null);
  const [error, setError] = useState(false);

  async function flip(feature: PortalFeatureKey, next: boolean): Promise<void> {
    setBusy(feature);
    setError(false);
    setFeatures((f) => ({ ...f, [feature]: next }));
    const res = await fetch(`/api/clients/${clientId}/portal/features`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ feature, enabled: next }),
    }).catch(() => null);
    setBusy(null);
    if (!res?.ok) {
      setFeatures((f) => ({ ...f, [feature]: !next }));
      setError(true);
      return;
    }
    router.refresh();
  }

  return (
    <PortalCard
      icon={<SlidersIcon />}
      title="Features"
      description="Choose which sections the client sees in their portal. Dashboard, Organizer and Settings are always available."
    >
      <ul className="divide-y divide-hair">
        {PORTAL_FEATURE_META.map((feature) => {
          const enabled = features[feature.key];
          return (
            <li
              key={feature.key}
              className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0"
            >
              <div className="min-w-0">
                <div className="text-[13px] font-medium text-ink">{feature.label}</div>
                <p className="mt-0.5 max-w-prose text-[12px] leading-relaxed text-ink-3">
                  {feature.description}
                </p>
              </div>
              {/* pt-0.5 aligns the switch with the first line of the label. */}
              <div className="shrink-0 pt-0.5">
                <SwitchControl
                  checked={enabled}
                  onChange={(next) => void flip(feature.key, next)}
                  disabled={busy !== null}
                  ariaLabel={`Show ${feature.label} in the client portal`}
                  stateLabel={enabled ? "On" : "Off"}
                />
              </div>
            </li>
          );
        })}
      </ul>
      {error && (
        <p role="alert" className="mt-3 text-[12px] text-crit">
          Could not save that change. Please try again.
        </p>
      )}
    </PortalCard>
  );
}
