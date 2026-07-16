import { and, desc, eq, gte, inArray, isNull, isNotNull, lte, ne } from "drizzle-orm";
import { db } from "@/db";
import {
  clientImports,
  clients,
  crmHouseholdContacts,
  crmHouseholds,
  crmTaskCommentMentions,
  crmTaskComments,
  crmTasks,
  intakeForms,
} from "@/db/schema";
import { advisorScopeCondition, resolveVisibleAdvisorIds } from "@/lib/visibility";
import { assembleFeed } from "./feed-assemble";
import { milestonesWithin, nextBirthdayWithin, parseDateOnly } from "./dates";
import type { FeedItem, HomeFeed } from "./types";

const SOURCE_LIMIT = 20;
const BIRTHDAY_WINDOW_DAYS = 30;
const MILESTONE_WINDOW_DAYS = 90;
const RECENT_WINDOW_DAYS = 14;
const MENTION_SUBTITLE_MAX = 120;

interface ContactRow {
  id: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string | null;
  householdId: string;
  householdName: string;
}

/** Pure: one scoped contact row → 0..n birthday/milestone feed items. */
export function contactToFeedItems(contact: ContactRow, today: Date): FeedItem[] {
  if (!contact.dateOfBirth) return [];
  const name = `${contact.firstName} ${contact.lastName}`;
  const href = `/crm/households/${contact.householdId}`;
  const items: FeedItem[] = [];
  const bday = nextBirthdayWithin(contact.dateOfBirth, today, BIRTHDAY_WINDOW_DAYS);
  if (bday) {
    items.push({
      id: `birthday:${contact.id}:${bday.date.getFullYear()}`,
      kind: "birthday",
      title: `${name} turns ${bday.turning}`,
      subtitle: contact.householdName,
      href,
      when: bday.date,
    });
  }
  for (const m of milestonesWithin(contact.dateOfBirth, today, MILESTONE_WINDOW_DAYS)) {
    items.push({
      id: `milestone:${contact.id}:${m.key}`,
      kind: "milestone",
      title: `${name} ${m.label}`,
      subtitle: m.why,
      href,
      when: m.date,
    });
  }
  return items;
}

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function daysAgo(today: Date, days: number): Date {
  return new Date(today.getFullYear(), today.getMonth(), today.getDate() - days);
}

/**
 * Household-scoped WHERE conditions shared by the birthday/milestone and import
 * sources. Applies advisor visibility + firm + not-deleted + active/prospect,
 * mirroring `kpis.ts`. Household-derived sources only.
 */
async function scopedHouseholdConditions(
  firmId: string,
  userId: string,
  orgRole: string | null | undefined,
) {
  const visible = await resolveVisibleAdvisorIds(userId, orgRole, firmId);
  const scope = advisorScopeCondition(crmHouseholds.advisorId, visible);
  const conditions = [
    eq(crmHouseholds.firmId, firmId),
    isNull(crmHouseholds.deletedAt),
    inArray(crmHouseholds.status, ["active", "prospect"]),
  ];
  if (scope) conditions.push(scope);
  return conditions;
}

async function fetchMyTaskItems(
  firmId: string,
  userId: string,
  today: Date,
): Promise<FeedItem[]> {
  const todayIso = toIsoDate(today);
  const weekEndIso = toIsoDate(
    new Date(today.getFullYear(), today.getMonth(), today.getDate() + 7),
  );
  const rows = await db
    .select({
      id: crmTasks.id,
      title: crmTasks.title,
      dueDate: crmTasks.dueDate,
      householdName: crmHouseholds.name,
    })
    .from(crmTasks)
    .leftJoin(crmHouseholds, eq(crmTasks.householdId, crmHouseholds.id))
    .where(
      and(
        eq(crmTasks.firmId, firmId),
        eq(crmTasks.assigneeUserId, userId),
        inArray(crmTasks.status, ["open", "in_progress", "blocked"]),
        isNotNull(crmTasks.dueDate),
        lte(crmTasks.dueDate, weekEndIso),
      ),
    )
    .orderBy(crmTasks.dueDate)
    .limit(SOURCE_LIMIT);
  return rows.map((r) => ({
    id: `task:${r.id}`,
    kind: "task-due" as const,
    title: r.title,
    subtitle: r.householdName ?? null,
    href: `/tasks?task=${r.id}`,
    when: parseDateOnly(r.dueDate!),
    overdue: r.dueDate! < todayIso,
  }));
}

async function fetchBirthdayAndMilestoneItems(
  firmId: string,
  userId: string,
  orgRole: string | null | undefined,
  today: Date,
): Promise<FeedItem[]> {
  const conditions = await scopedHouseholdConditions(firmId, userId, orgRole);
  const rows = await db
    .select({
      id: crmHouseholdContacts.id,
      firstName: crmHouseholdContacts.firstName,
      lastName: crmHouseholdContacts.lastName,
      dateOfBirth: crmHouseholdContacts.dateOfBirth,
      householdId: crmHouseholdContacts.householdId,
      householdName: crmHouseholds.name,
    })
    .from(crmHouseholdContacts)
    .innerJoin(crmHouseholds, eq(crmHouseholdContacts.householdId, crmHouseholds.id))
    .where(
      and(
        ...conditions,
        inArray(crmHouseholdContacts.role, ["primary", "spouse"]),
        isNotNull(crmHouseholdContacts.dateOfBirth),
      ),
    );
  return rows.flatMap((r) => contactToFeedItems(r, today));
}

async function fetchMentionItems(
  firmId: string,
  userId: string,
  today: Date,
): Promise<FeedItem[]> {
  // firmId + mentionedUserId live only on the mentions row, and it carries the
  // dedicated feed index (firmId, mentionedUserId, createdAt). Filter, order,
  // and `when` all use crmTaskCommentMentions.createdAt so the whole query is
  // served from that index and the displayed timestamp matches what we sorted
  // by. The mention is inserted in the same transaction as its comment (see
  // crm-tasks/mutations.ts), so this is the same instant as the comment.
  const rows = await db
    .select({
      id: crmTaskCommentMentions.id,
      taskId: crmTaskCommentMentions.taskId,
      taskTitle: crmTasks.title,
      body: crmTaskComments.bodyMarkdown,
      createdAt: crmTaskCommentMentions.createdAt,
    })
    .from(crmTaskCommentMentions)
    .innerJoin(crmTaskComments, eq(crmTaskCommentMentions.commentId, crmTaskComments.id))
    .innerJoin(crmTasks, eq(crmTaskCommentMentions.taskId, crmTasks.id))
    .where(
      and(
        eq(crmTaskCommentMentions.firmId, firmId),
        eq(crmTaskCommentMentions.mentionedUserId, userId),
        ne(crmTaskComments.authorUserId, userId),
        gte(crmTaskCommentMentions.createdAt, daysAgo(today, RECENT_WINDOW_DAYS)),
      ),
    )
    .orderBy(desc(crmTaskCommentMentions.createdAt))
    .limit(SOURCE_LIMIT);
  return rows.map((r) => ({
    id: `mention:${r.id}`,
    kind: "mention" as const,
    title: r.taskTitle,
    subtitle:
      r.body.length > MENTION_SUBTITLE_MAX
        ? `${r.body.slice(0, MENTION_SUBTITLE_MAX)}…`
        : r.body,
    href: `/tasks?task=${r.taskId}`,
    when: r.createdAt,
  }));
}

async function fetchIntakeItems(firmId: string, today: Date): Promise<FeedItem[]> {
  const rows = await db
    .select({
      id: intakeForms.id,
      recipientName: intakeForms.recipientName,
      recipientEmail: intakeForms.recipientEmail,
      submittedAt: intakeForms.submittedAt,
    })
    .from(intakeForms)
    .where(
      and(
        eq(intakeForms.firmId, firmId),
        eq(intakeForms.status, "submitted"),
        gte(intakeForms.submittedAt, daysAgo(today, RECENT_WINDOW_DAYS)),
      ),
    )
    .orderBy(desc(intakeForms.submittedAt))
    .limit(SOURCE_LIMIT);
  return rows.map((r) => ({
    id: `intake:${r.id}`,
    kind: "intake-submitted" as const,
    title: `${r.recipientName ?? r.recipientEmail} submitted their intake form`,
    subtitle: null,
    href: "/data-collection",
    when: r.submittedAt!,
  }));
}

async function fetchImportItems(
  firmId: string,
  userId: string,
  orgRole: string | null | undefined,
  today: Date,
): Promise<FeedItem[]> {
  const conditions = await scopedHouseholdConditions(firmId, userId, orgRole);
  const rows = await db
    .select({
      id: clientImports.id,
      committedAt: clientImports.committedAt,
      householdId: crmHouseholds.id,
      householdName: crmHouseholds.name,
    })
    .from(clientImports)
    .innerJoin(clients, eq(clientImports.clientId, clients.id))
    .innerJoin(crmHouseholds, eq(clients.crmHouseholdId, crmHouseholds.id))
    .where(
      and(
        ...conditions,
        eq(clientImports.orgId, firmId),
        eq(clientImports.status, "committed"),
        gte(clientImports.committedAt, daysAgo(today, RECENT_WINDOW_DAYS)),
      ),
    )
    .orderBy(desc(clientImports.committedAt))
    .limit(SOURCE_LIMIT);
  return rows.map((r) => ({
    id: `import:${r.id}`,
    kind: "import-committed" as const,
    title: `Import committed for ${r.householdName}`,
    subtitle: null,
    href: `/crm/households/${r.householdId}`,
    when: r.committedAt!,
  }));
}

/** One failing source drops out silently; the rest still render. */
export async function getHomeFeed(
  firmId: string,
  userId: string,
  orgRole: string | null | undefined,
  today: Date,
): Promise<HomeFeed> {
  const settled = await Promise.allSettled([
    fetchMyTaskItems(firmId, userId, today),
    fetchBirthdayAndMilestoneItems(firmId, userId, orgRole, today),
    fetchMentionItems(firmId, userId, today),
    fetchIntakeItems(firmId, today),
    fetchImportItems(firmId, userId, orgRole, today),
  ]);
  const items = settled
    .filter((s): s is PromiseFulfilledResult<FeedItem[]> => s.status === "fulfilled")
    .flatMap((s) => s.value);
  return assembleFeed(items, today);
}
