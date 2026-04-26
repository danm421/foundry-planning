"use client";

// src/components/scenario/snapshot-banner.tsx
//
// Read-only mode marker rendered above a report when the active compare side
// is a frozen snapshot (`?left=snap:<id>` or `?right=snap:<id>`). Warns the
// advisor that they're looking at a captured pair-tree rather than the live
// projection, and exposes a one-click "Return to live" affordance that calls
// `setSide(side, null)` — the hook treats `null` the same as `"base"`, so the
// param is dropped from the URL and the page falls back to the live view.
//
// Visual vocabulary mirrors `<ScenarioModeBanner>`: same amber border-bottom
// rule, same uppercase mono header chrome. The thin slab is intentional — it
// has to read at-a-glance from across a meeting room without taking pixels
// away from the chart underneath.

import { useCompareState } from "@/hooks/use-compare-state";

export interface SnapshotBannerProps {
  clientId: string;
  /** Which compare side this banner annotates. */
  side: "left" | "right";
  snapshotName: string;
  /** Clerk userId — displayed verbatim until we wire up a directory lookup. */
  frozenBy: string;
  /** Either a Date instance (server) or an ISO string (after JSON serialization). */
  frozenAt: Date | string;
}

export function SnapshotBanner({
  clientId,
  side,
  snapshotName,
  frozenBy,
  frozenAt,
}: SnapshotBannerProps) {
  const { setSide } = useCompareState(clientId);
  const date = typeof frozenAt === "string" ? new Date(frozenAt) : frozenAt;
  return (
    <div
      data-testid={`snapshot-banner-${side}`}
      className="px-6 py-2 border-b border-[#7a5b29] bg-[#0b0c0f] text-[11px] tracking-[0.18em] uppercase font-mono text-[#7a5b29] flex items-center justify-between"
    >
      <span>
        VIEWING SNAPSHOT ({side.toUpperCase()}) · {snapshotName} · FROZEN BY{" "}
        {frozenBy} · {date.toLocaleDateString()}
      </span>
      <button
        type="button"
        onClick={() => setSide(side, null)}
        className="text-[11px] text-[#a09c92] hover:text-[#e7e6e2] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#d4a04a] rounded normal-case tracking-normal"
      >
        [Return to live]
      </button>
    </div>
  );
}
