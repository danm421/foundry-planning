import { db } from "@/db";
import { clients, scenarios, gifts, giftSeries } from "@/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { loadActiveGiftChanges } from "@/lib/scenario/changes";
import { overlayGiftDrafts } from "@/lib/scenario/apply-gift-overlays";
import {
  giftRowToDraft,
  giftSeriesRowToDraft,
  type EstateFlowGift,
} from "./estate-flow-gifts";

/** Representable gift drafts for a client + scenario (cash/asset/series;
 *  bundled-liability and business-interest rows are excluded). Shared by the
 *  estate-flow editor and the solver estate tab.
 *
 *  The scenario's own `gift` changes are overlaid on top of the base rows, so a
 *  gift added in the solver and saved to a scenario reloads into the editor it
 *  was created in. Without that overlay the editors would show only base-plan
 *  gifts while the projection they sit next to already counted the scenario's —
 *  the list and the numbers would disagree. */
export async function loadGiftDrafts(
  clientId: string,
  firmId: string,
  scenarioId: string,
): Promise<EstateFlowGift[]> {
  return (await loadGiftDraftState(clientId, firmId, scenarioId)).drafts;
}

/** `loadGiftDrafts` plus which recurring gifts are the scenario's own `gift`
 *  changes rather than rows of its `gift_series` partition. Only the former
 *  open in the Solver's Changes tab. */
export async function loadGiftDraftState(
  clientId: string,
  firmId: string,
  scenarioId: string,
): Promise<{ drafts: EstateFlowGift[]; overlaySeriesIds: string[] }> {
  const scenarioRows = await db
    .select({ id: scenarios.id, isBaseCase: scenarios.isBaseCase })
    .from(scenarios)
    .innerJoin(clients, eq(clients.id, scenarios.clientId))
    .where(and(eq(scenarios.clientId, clientId), eq(clients.firmId, firmId)));
  const resolved =
    scenarioId === "base"
      ? scenarioRows.find((s) => s.isBaseCase)
      : scenarioRows.find((s) => s.id === scenarioId);
  if (!resolved) return { drafts: [], overlaySeriesIds: [] };

  const [giftRows, giftSeriesRows, giftChanges] = await Promise.all([
    db.select().from(gifts).where(eq(gifts.clientId, clientId)).orderBy(asc(gifts.year), asc(gifts.createdAt)),
    db.select().from(giftSeries).where(and(eq(giftSeries.clientId, clientId), eq(giftSeries.scenarioId, resolved.id))),
    loadActiveGiftChanges(resolved.id),
  ]);

  const baseDrafts = [
    ...giftRows.map(giftRowToDraft).filter((g): g is EstateFlowGift => g !== null),
    ...giftSeriesRows.map((r) => giftSeriesRowToDraft(r)),
  ];
  const drafts = overlayGiftDrafts(baseDrafts, giftChanges);
  // The overlay keeps surviving base drafts by reference and appends the
  // changes' own payloads, so a series that is not one of `baseDrafts` is an
  // overlay series.
  const baseSet = new Set(baseDrafts);
  const overlaySeriesIds = drafts
    .filter((g) => g.kind === "series" && !baseSet.has(g))
    .map((g) => g.id);
  return { drafts, overlaySeriesIds };
}
