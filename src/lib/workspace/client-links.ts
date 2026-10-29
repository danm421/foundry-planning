import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { crmHouseholdContacts, crmHouseholds } from "@/db/schema";
import {
  advisorScopeCondition,
  privateHouseholdFilter,
  resolveVisibleAdvisorIds,
} from "@/lib/visibility";
import type { WorkspaceEvent } from "./types";

export type HouseholdLink = { householdId: string; householdName: string };

/**
 * Match attendee emails to the live CRM households the caller may see (book
 * rule + Private client rule). Keyed by lowercased email; an email on two
 * households maps to the first by household name.
 */
export async function findHouseholdsByEmail(input: {
  firmId: string;
  userId: string;
  orgRole: string | null | undefined;
  emails: string[];
}): Promise<Map<string, HouseholdLink>> {
  const result = new Map<string, HouseholdLink>();
  const emails = [...new Set(input.emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (emails.length === 0) return result;

  const visible = await resolveVisibleAdvisorIds(input.userId, input.orgRole, input.firmId);
  const lowerEmail = sql<string>`lower(${crmHouseholdContacts.email})`;
  const rows = await db
    .select({
      email: lowerEmail,
      householdId: crmHouseholds.id,
      householdName: crmHouseholds.name,
    })
    .from(crmHouseholdContacts)
    .innerJoin(crmHouseholds, eq(crmHouseholds.id, crmHouseholdContacts.householdId))
    .where(
      and(
        eq(crmHouseholds.firmId, input.firmId),
        isNull(crmHouseholds.deletedAt),
        advisorScopeCondition(crmHouseholds.advisorId, visible),
        privateHouseholdFilter(input.firmId, input.userId, input.orgRole),
        inArray(lowerEmail, emails),
      ),
    )
    .orderBy(asc(crmHouseholds.name), asc(crmHouseholds.id));

  for (const r of rows) {
    if (!result.has(r.email)) {
      result.set(r.email, { householdId: r.householdId, householdName: r.householdName });
    }
  }
  return result;
}

/** The household of the first attendee whose email is in `links`, else null. */
export function linkEventHousehold(
  event: WorkspaceEvent,
  links: Map<string, HouseholdLink>,
): HouseholdLink | null {
  for (const a of event.attendees) {
    const hit = links.get(a.email.toLowerCase());
    if (hit) return hit;
  }
  return null;
}
