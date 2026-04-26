// src/lib/scenario/snapshot-banner-data.ts
//
// Server-side fetcher used by each report page to render the snapshot banner
// + hydrate the right-hand toggle list from the frozen row when a compare
// side resolves to a snapshot ref.
//
// Firm scoping mirrors `loadEffectiveTreeForRef` exactly: the inner-join on
// `clients.firmId` ensures a snapshot id from another firm's client cannot be
// surfaced even if the URL is hand-crafted. Returns `null` when the ref is
// not a snapshot (so the page can render the live banner-less view), which
// keeps the call-site `await` parallel with the live-DB fetches.

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { clients, scenarioSnapshots } from "@/db/schema";
import type { ScenarioRef } from "./loader";
import type { ToggleGroup } from "@/engine/scenario/types";

export interface SnapshotBannerData {
  id: string;
  name: string;
  frozenAt: Date;
  frozenByUserId: string;
  /**
   * Frozen toggle-group rows captured at snapshot time. Empty when the source
   * right ref was the base case or itself a snapshot. Used to hydrate the
   * Compare panel's `<ToggleList>` so the user can see what was on/off
   * without a fresh DB lookup against the (possibly deleted) source scenario.
   */
  rawToggleGroupsRight: ToggleGroup[];
}

/**
 * Returns the banner-relevant fields for a snapshot ref, scoped to the firm
 * via the parent client. Returns `null` for non-snapshot refs.
 *
 * Throws when the ref points at a snapshot that doesn't belong to the given
 * (client, firm) pair — same posture as `loadEffectiveTreeForRef`. Callers
 * should not catch this; a mismatch indicates a malformed URL or an authz
 * leak attempt and should surface as a 500.
 */
export async function loadSnapshotBannerData(
  clientId: string,
  firmId: string,
  ref: ScenarioRef,
): Promise<SnapshotBannerData | null> {
  if (ref.kind !== "snapshot") return null;

  const [row] = await db
    .select({
      id: scenarioSnapshots.id,
      name: scenarioSnapshots.name,
      frozenAt: scenarioSnapshots.frozenAt,
      frozenByUserId: scenarioSnapshots.frozenByUserId,
      rawToggleGroupsRight: scenarioSnapshots.rawToggleGroupsRight,
    })
    .from(scenarioSnapshots)
    .innerJoin(clients, eq(clients.id, scenarioSnapshots.clientId))
    .where(
      and(
        eq(scenarioSnapshots.id, ref.id),
        eq(scenarioSnapshots.clientId, clientId),
        eq(clients.firmId, firmId),
      ),
    );

  if (!row) {
    throw new Error(`Snapshot ${ref.id} not found for client ${clientId}`);
  }

  return {
    id: row.id,
    name: row.name,
    frozenAt: row.frozenAt,
    frozenByUserId: row.frozenByUserId,
    // jsonb column → unknown by drizzle's inferred type. We cast to the
    // app-side type; the writer (createSnapshot) inserts rows from the same
    // shape, so the cast is safe in practice.
    rawToggleGroupsRight: (row.rawToggleGroupsRight as ToggleGroup[]) ?? [],
  };
}
