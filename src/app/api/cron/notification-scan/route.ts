// src/app/api/cron/notification-scan/route.ts
//
// GET /api/cron/notification-scan -- daily Vercel Cron (vercel.ts, 0 8 * * *).
//
// Auth: Bearer CRON_SECRET. System job: operates across ALL firms by design,
// so it does not go through per-user org scoping.
//
// Materializes the date-derived notification categories, which have no write
// site to hang a producer off. Runs an hour before notification-digest so its
// rows are in place for that morning's email; separate routes so a scanner
// failure does not take the email with it.
//
// Plan 1 wires `client_birthday` only. `client_milestone_age`,
// `risk_review_due`, and `task_due_soon` join this route in Plan 2.
import { type NextRequest, NextResponse } from "next/server";
import { eq, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { clients, crmHouseholdContacts, notificationPreferences } from "@/db/schema";
import { enqueueNotifications } from "@/lib/notifications/enqueue";
import { DEFAULT_DATE_DIGEST_CADENCE, type DateDigestCadence } from "@/lib/notifications/catalog";
import {
  shouldFireOn,
  cadenceWindow,
  occurrenceInWindow,
  ageTurning,
  birthdayDedupKey,
} from "@/lib/notifications/scan/birthdays";

export const dynamic = "force-dynamic";
// One pass over every advisor's book. Same rationale as refresh-risk-capacity:
// the default timeout would silently starve the advisors at the end of the list.
export const maxDuration = 300;

export async function GET(req: NextRequest): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const today = new Date();
  let advisorsFired = 0;
  let rowsEnqueued = 0;

  // Every contact with a DOB, joined to the household's owning advisor. The
  // recipient is `clients.advisorId` — decision 1, owning advisor only.
  const rows = await db
    .select({
      contactId: crmHouseholdContacts.id,
      firstName: crmHouseholdContacts.firstName,
      lastName: crmHouseholdContacts.lastName,
      dateOfBirth: crmHouseholdContacts.dateOfBirth,
      householdId: crmHouseholdContacts.householdId,
      clientId: clients.id,
      firmId: clients.firmId,
      advisorId: clients.advisorId,
    })
    .from(crmHouseholdContacts)
    .innerJoin(clients, eq(clients.crmHouseholdId, crmHouseholdContacts.householdId))
    .where(isNotNull(crmHouseholdContacts.dateOfBirth));

  // Cadence is per-advisor, so group the book by advisor before windowing.
  // Keyed on NUL: it cannot occur inside a Clerk org id or user id, so the
  // composite key can never collide with a firmId/advisorId that happens to
  // contain the delimiter.
  const byAdvisor = new Map<string, typeof rows>();
  for (const r of rows) {
    if (!r.advisorId) continue;
    const key = `${r.firmId}\0${r.advisorId}`;
    const list = byAdvisor.get(key);
    if (list) list.push(r);
    else byAdvisor.set(key, [r]);
  }

  const prefRows = await db
    .select({
      firmId: notificationPreferences.firmId,
      userId: notificationPreferences.userId,
      cadence: notificationPreferences.dateDigestCadence,
    })
    .from(notificationPreferences);
  const cadenceByAdvisor = new Map(
    prefRows.map((p) => [`${p.firmId}\0${p.userId}`, p.cadence]),
  );

  for (const [key, book] of byAdvisor) {
    const [firmId, advisorId] = key.split("\0");
    const cadence: DateDigestCadence =
      cadenceByAdvisor.get(key) ?? DEFAULT_DATE_DIGEST_CADENCE;
    if (!shouldFireOn(cadence, today)) continue;
    advisorsFired++;

    const window = cadenceWindow(cadence, today);
    for (const person of book) {
      if (!person.dateOfBirth) continue;
      const occurrence = occurrenceInWindow(person.dateOfBirth, window);
      if (!occurrence) continue;

      const name =
        [person.firstName, person.lastName].filter(Boolean).join(" ") || "A client";
      const turns = ageTurning(person.dateOfBirth, occurrence);

      // dedupKey makes this insert idempotent: overlapping cadence windows and
      // a re-run of this cron both collapse onto the same row.
      await enqueueNotifications({
        firmId,
        recipients: [advisorId],
        category: "client_birthday",
        actorUserId: null,
        clientId: person.clientId,
        title: `${name} turns ${turns} on ${occurrence}`,
        body: null,
        url: `/crm/households/${person.householdId}`,
        entityType: "crm_household_contact",
        entityId: person.contactId,
        dedupKey: birthdayDedupKey(person.contactId, occurrence),
      });
      rowsEnqueued++;
    }
  }

  return NextResponse.json({ ok: true, advisorsFired, rowsEnqueued });
}
