"use client";

// src/components/scenario/snapshot-button.tsx
//
// Bottom-of-panel "Snapshot for presentation" button. Reads the current
// (left, right) compare pair from the URL via `useCompareState`, prompts the
// user for a name, and POSTs the freeze request to
// `/api/clients/[id]/snapshots`. Disabled when the two sides match (the route
// itself also rejects no-op snapshots — defense in depth).
//
// Naming UX is intentionally `window.prompt`-based for now — Task 36 is
// mechanical wiring; a real modal can replace it once Task 37 lands the
// snapshot management UI.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useCompareState } from "@/hooks/use-compare-state";

export interface SnapshotButtonProps {
  clientId: string;
  /**
   * External disable signal — currently set by ComparePanel when the right
   * side is already a frozen snapshot (snapshotting a snapshot is meaningless,
   * and the route would just freeze the same trees a second time).
   */
  disabled?: boolean;
}

export function SnapshotButton({
  clientId,
  disabled: externalDisabled = false,
}: SnapshotButtonProps) {
  const router = useRouter();
  const { left, right, toggleSet } = useCompareState(clientId);
  const [loading, setLoading] = useState(false);

  // The route also rejects a no-op (left === right) with a 400, but we mirror
  // that as a `disabled` flag on the button so the affordance reads correctly.
  const sameSide = left === right;
  const disabled = loading || sameSide || externalDisabled;

  async function snap() {
    const name = window.prompt("Snapshot name?");
    if (!name || !name.trim()) return;
    setLoading(true);
    try {
      // Convert the URL `Set<string>` of toggle group ids to the route's
      // `Record<string, boolean>` body shape. Only the right side honors
      // toggles, but the route is the one responsible for that distinction.
      const toggleState: Record<string, boolean> = {};
      for (const id of toggleSet) toggleState[id] = true;

      const res = await fetch(`/api/clients/${clientId}/snapshots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          left,
          right,
          toggleState,
          name: name.trim(),
          sourceKind: "manual",
        }),
      });
      if (!res.ok) {
        // Route logs server-side; surface a console error so the failure is
        // visible during dev. Replace with a toast once we have one.
        console.error(
          "Snapshot create failed:",
          res.status,
          await res.text().catch(() => ""),
        );
        return;
      }
      // Refresh so any server-rendered snapshot list (Task 37 picker) sees
      // the new row on next paint.
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-4 border-t border-[#1f2024]">
      <button
        type="button"
        onClick={snap}
        disabled={disabled}
        data-testid="snapshot-button"
        className="w-full h-10 rounded bg-[#7a5b29] text-[#0b0c0f] text-[13px] font-medium hover:bg-[#8a6a35] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#d4a04a] disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? "Freezing…" : "Snapshot for presentation"}
      </button>
    </div>
  );
}
