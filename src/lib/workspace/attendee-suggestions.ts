import { and, asc, eq, ilike, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { crmHouseholdContacts, crmHouseholds } from "@/db/schema";
import { listFirmMembers } from "@/lib/crm-tasks/members";
import { containsPattern } from "@/lib/like-pattern";
import {
  advisorScopeCondition,
  privateHouseholdFilter,
  resolveVisibleAdvisorIds,
} from "@/lib/visibility";

export type AttendeeSuggestion = { email: string; name: string; kind: "client" | "team" };

const MAX_CLIENTS = 6;
const MAX_TEAM = 4;

/**
 * Type-ahead attendee suggestions: visible CRM contacts with an email first,
 * then firm teammates (never the caller), deduped by lowercased email.
 */
export async function suggestAttendees(input: {
  firmId: string;
  userId: string;
  orgRole: string | null | undefined;
  query: string;
}): Promise<AttendeeSuggestion[]> {
  const query = input.query.trim();
  if (query.length < 2) return [];

  const visible = await resolveVisibleAdvisorIds(input.userId, input.orgRole, input.firmId);
  const c = crmHouseholdContacts;
  const pattern = containsPattern(query);
  const displayName = sql<string>`trim(coalesce(${c.preferredName}, ${c.firstName}) || ' ' || ${c.lastName})`;
  const contacts = await db
    .select({ email: c.email, name: displayName })
    .from(c)
    .innerJoin(crmHouseholds, eq(crmHouseholds.id, c.householdId))
    .where(
      and(
        eq(crmHouseholds.firmId, input.firmId),
        isNull(crmHouseholds.deletedAt),
        advisorScopeCondition(crmHouseholds.advisorId, visible),
        privateHouseholdFilter(input.firmId, input.userId, input.orgRole),
        isNotNull(c.email),
        ne(c.email, ""),
        or(ilike(displayName, pattern), ilike(c.email, pattern)),
      ),
    )
    .orderBy(asc(c.lastName), asc(c.firstName), asc(c.id));

  const seen = new Set<string>();
  const out: AttendeeSuggestion[] = [];
  for (const row of contacts) {
    const email = row.email?.trim();
    if (!email || seen.has(email.toLowerCase())) continue;
    seen.add(email.toLowerCase());
    out.push({ email, name: row.name, kind: "client" });
    if (out.length === MAX_CLIENTS) break;
  }

  const needle = query.toLowerCase();
  let team = 0;
  for (const m of await listFirmMembers(input.firmId)) {
    if (team === MAX_TEAM) break;
    if (m.userId === input.userId || !m.email) continue;
    const key = m.email.toLowerCase();
    if (seen.has(key)) continue;
    if (!m.displayName.toLowerCase().includes(needle) && !key.includes(needle)) continue;
    seen.add(key);
    out.push({ email: m.email, name: m.displayName, kind: "team" });
    team++;
  }
  return out;
}
