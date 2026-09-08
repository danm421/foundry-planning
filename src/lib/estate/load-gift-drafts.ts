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
  const scenarioRows = await db
    .select({ id: scenarios.id, isBaseCase: scenarios.isBaseCase })
    .from(scenarios)
    .innerJoin(clients, eq(clients.id, scenarios.clientId))
    .where(and(eq(scenarios.clientId, clientId), eq(clients.firmId, firmId)));
  const resolved =
    scenarioId === "base"
      ? scenarioRows.find((s) => s.isBaseCase)
      : scenarioRows.find((s) => s.id === scenarioId);
  if (!resolved) return [];

  const [giftRows, giftSeriesRows, giftChanges] = await Promise.all([
    db.select().from(gifts).where(eq(gifts.clientId, clientId)).orderBy(asc(gifts.year), asc(gifts.createdAt)),
    db.select().from(giftSeries).where(and(eq(giftSeries.clientId, clientId), eq(giftSeries.scenarioId, resolved.id))),
    loadActiveGiftChanges(resolved.id),
  ]);

  return overlayGiftDrafts(
    [
      ...giftRows.map(giftRowToDraft).filter((g): g is EstateFlowGift => g !== null),
      ...giftSeriesRows.map((r) => giftSeriesRowToDraft(r)),
    ],
    giftChanges,
  );
}
