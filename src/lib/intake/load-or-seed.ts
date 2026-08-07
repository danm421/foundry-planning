/**
 * loadOrSeedPortalIntakeForm — shared helper used by both the portal intake
 * route (GET /api/portal/intake) and the portal intake page (server component).
 *
 * Loads the active prefilled form for a client. If the form payload is empty
 * (zero keys — the column default), lazily seeds it from the client's live
 * planning data via snapshotClientToPayload and persists it. Returns the
 * payload, status, sections, and formId — or null when no active form exists.
 *
 * Auth: both callers have already verified portal access and resolved firmId
 * before calling this. firmId is the org-scoping guard.
 */

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { intakeForms } from "@/db/schema";
import { loadActivePrefilledForm } from "./queries";
import { snapshotClientToPayload } from "./snapshot";
import { sectionsForForm, type IntakeSectionKey } from "./sections";
import type { IntakePayload } from "./schema";

export interface PortalIntakeFormResult {
  formId: string;
  payload: IntakePayload;
  status: typeof intakeForms.$inferSelect["status"];
  recipientName: string | null;
  /** What this form collects. A null column means the default set. */
  sections: IntakeSectionKey[];
}

export async function loadOrSeedPortalIntakeForm(
  clientId: string,
  firmId: string,
): Promise<PortalIntakeFormResult | null> {
  const form = await loadActivePrefilledForm(clientId);
  if (!form) return null;

  const sections = sectionsForForm(form.sections);

  const raw = form.payload as IntakePayload | Record<string, never>;
  // "Never seeded" is ZERO KEYS — `intake_forms.payload` defaults to `{}`.
  // It must NOT key on the presence of `family`: a form whose sections exclude
  // Family is seeded WITHOUT that key at all, so a family-based sentinel would
  // read every seeded docs-only form as never-seeded and re-seed it on every
  // load, discarding whatever the client had already filled in.
  const isEmpty = !raw || Object.keys(raw).length === 0;

  if (isEmpty) {
    const seed = await snapshotClientToPayload(clientId, firmId, sections);
    await db
      .update(intakeForms)
      .set({ payload: seed, updatedAt: new Date() })
      .where(eq(intakeForms.id, form.id));

    return {
      formId: form.id,
      payload: seed,
      status: form.status,
      recipientName: form.recipientName ?? null,
      sections,
    };
  }

  return {
    formId: form.id,
    payload: raw as IntakePayload,
    status: form.status,
    recipientName: form.recipientName ?? null,
    sections,
  };
}
