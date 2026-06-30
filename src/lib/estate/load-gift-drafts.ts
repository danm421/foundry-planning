import { db } from "@/db";
import { clients, scenarios, gifts, giftSeries } from "@/db/schema";
import { eq, and, asc } from "drizzle-orm";
import {
  giftRowToDraft,
  giftSeriesRowToDraft,
  type EstateFlowGift,
} from "./estate-flow-gifts";

/** Representable base-plan gift drafts for a client + scenario (cash/asset/
 *  series; bundled-liability and business-interest rows are excluded). Shared by
 *  the estate-flow editor and the solver estate tab. */
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

  const [giftRows, giftSeriesRows] = await Promise.all([
    db.select().from(gifts).where(eq(gifts.clientId, clientId)).orderBy(asc(gifts.year), asc(gifts.createdAt)),
    db.select().from(giftSeries).where(and(eq(giftSeries.clientId, clientId), eq(giftSeries.scenarioId, resolved.id))),
  ]);

  return [
    ...giftRows.map(giftRowToDraft).filter((g): g is EstateFlowGift => g !== null),
    ...giftSeriesRows.map((r) => giftSeriesRowToDraft(r)),
  ];
}
