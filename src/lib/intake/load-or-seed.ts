/**
 * loadOrSeedPortalIntakeForm — shared helper used by both the portal intake
 * route (GET /api/portal/intake) and the portal intake page (server component).
 *
 * Loads the active prefilled form for a client. If the form payload is empty
 * (no `family` key / zero keys), lazily seeds it from the client's live
 * planning data via snapshotClientToPayload and persists it. Returns the
 * payload, status, and formId — or null when no active form exists.
 *
 * Auth: both callers have already verified portal access and resolved firmId
 * before calling this. firmId is the org-scoping guard.
 */

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { intakeForms } from "@/db/schema";
import { loadActivePrefilledForm } from "./queries";
import { snapshotClientToPayload } from "./snapshot";
import type { IntakePayload } from "./schema";

export interface PortalIntakeFormResult {
  formId: string;
  payload: IntakePayload;
  status: typeof intakeForms.$inferSelect["status"];
  recipientName: string | null;
}

export async function loadOrSeedPortalIntakeForm(
  clientId: string,
  firmId: string,
): Promise<PortalIntakeFormResult | null> {
  const form = await loadActivePrefilledForm(clientId);
  if (!form) return null;

  const raw = form.payload as IntakePayload | Record<string, never>;
  const isEmpty = !raw || !("family" in raw) || Object.keys(raw).length === 0;

  if (isEmpty) {
    const seed = await snapshotClientToPayload(clientId, firmId);
    await db
      .update(intakeForms)
      .set({ payload: seed, updatedAt: new Date() })
      .where(eq(intakeForms.id, form.id));

    return {
      formId: form.id,
      payload: seed,
      status: form.status,
      recipientName: form.recipientName ?? null,
    };
  }

  return {
    formId: form.id,
    payload: raw as IntakePayload,
    status: form.status,
    recipientName: form.recipientName ?? null,
  };
}
