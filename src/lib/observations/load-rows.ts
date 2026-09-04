// The PDF export's read of a household's observations. The Plan Story's
// `load-next-steps.ts` is the other reader; both filter to the CLIENT audience
// so an advisor-facing row (the seam the Details rework will write) never
// reaches a client-facing page.
//
// Org-scoping note: the caller has already proven clientId + firmId through
// its effective-tree load; rows carry no cross-client data, so this adds
// `client_id = ?` only, as the inline query it replaced did.
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { planObservations } from "@/db/schema";
import type { ObservationsRowInput } from "@/lib/presentations/pages/observations-next-steps/view-model";

export async function loadClientObservationRows(clientId: string): Promise<ObservationsRowInput[]> {
  return db
    .select({
      section: planObservations.section,
      topic: planObservations.topic,
      title: planObservations.title,
      body: planObservations.body,
      status: planObservations.status,
      owner: planObservations.owner,
      priority: planObservations.priority,
      targetDate: planObservations.targetDate,
      sortOrder: planObservations.sortOrder,
    })
    .from(planObservations)
    .where(and(eq(planObservations.clientId, clientId), eq(planObservations.audience, "client")))
    .orderBy(asc(planObservations.section), asc(planObservations.sortOrder), asc(planObservations.createdAt));
}
