//
// Read-only queries backing the Risk household list. This is a denormalized
// snapshot read off `client_risk_profiles` -- never a live recompute -- so the
// list page can render without running a projection per household.
import { db } from "@/db";
import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";
import { requireOrgId } from "@/lib/db-helpers";
import { requireClientAccess } from "@/lib/clients/authz";
import {
  clients,
  crmHouseholds,
  crmHouseholdContacts,
  clientRiskProfiles,
  clientRiskProfileEvents,
  riskQuestionnaires,
} from "@/db/schema";
import type { ClientRiskProfileEventRow } from "@/db/schema";
import {
  resolveVisibleAdvisorIds,
  advisorScopeCondition,
  applyBookSwitcher,
} from "@/lib/visibility";
import { RISK_LEVEL_LABELS, type RiskLevel } from "@/lib/risk-levels";
import type { BindingConstraint } from "./scoring";
import type { RiskProfileEventKind } from "./profile";

export const REVIEW_DUE_MONTHS = 12;

export interface RiskListRow {
  clientId: string;
  householdName: string;
  compositeScore: number | null;
  compositeLevel: RiskLevel | null;
  bindingConstraint: BindingConstraint;
  toleranceScore: number | null;
  toleranceSource: "rtq_client" | "rtq_advisor" | "manual" | null;
  toleranceConfirmedAt: Date | null;
  capacityScore: number | null;
  environmentAdj: number;
  requiredGrowthPct: number | null;
  updatedAt: Date | null;
}

export interface RiskListFlags {
  notEstablished: boolean;
  reviewDue: boolean;
  capacityConstrained: boolean;
  goalsOverReaching: boolean;
  capacityPending: boolean;
}

export function deriveListFlags(row: RiskListRow, now: Date): RiskListFlags {
  const notEstablished = row.toleranceScore === null;

  const dueAfter = row.toleranceConfirmedAt
    ? new Date(row.toleranceConfirmedAt)
    : null;
  if (dueAfter) dueAfter.setMonth(dueAfter.getMonth() + REVIEW_DUE_MONTHS);

  return {
    notEstablished,
    // A household with no profile is "not established", not "review due" --
    // two different calls to action.
    reviewDue: !notEstablished && dueAfter !== null && dueAfter <= now,
    capacityConstrained: row.bindingConstraint === "capacity",
    goalsOverReaching:
      row.requiredGrowthPct !== null &&
      row.capacityScore !== null &&
      row.requiredGrowthPct > row.capacityScore,
    capacityPending: row.capacityScore === null,
  };
}

/**
 * Every household the caller can see, with its profile. LEFT JOIN so households
 * that have never been profiled still appear -- surfacing those is the main
 * reason this page exists.
 *
 * Scoping mirrors listCrmHouseholds exactly. Without it the Risk page becomes a
 * way to enumerate households outside the caller's book.
 */
export async function listRiskProfiles(opts?: {
  viewAsAdvisorId?: string;
}): Promise<RiskListRow[]> {
  const firmId = await requireOrgId();
  const { userId, orgRole } = await auth();

  let visible = await resolveVisibleAdvisorIds(userId ?? "", orgRole, firmId);
  visible = applyBookSwitcher(visible, orgRole, opts?.viewAsAdvisorId);
  const scope = advisorScopeCondition(crmHouseholds.advisorId, visible);

  const conditions = [
    eq(crmHouseholds.firmId, firmId),
    isNull(crmHouseholds.deletedAt),
  ];
  if (scope) conditions.push(scope);

  const rows = await db
    .select({
      clientId: clients.id,
      householdName: crmHouseholds.name,
      compositeScore: clientRiskProfiles.compositeScore,
      compositeLevel: clientRiskProfiles.compositeLevel,
      bindingConstraint: clientRiskProfiles.bindingConstraint,
      toleranceScore: clientRiskProfiles.toleranceScore,
      toleranceSource: clientRiskProfiles.toleranceSource,
      toleranceConfirmedAt: clientRiskProfiles.toleranceConfirmedAt,
      capacityScore: clientRiskProfiles.capacityScore,
      environmentAdj: clientRiskProfiles.environmentAdj,
      requiredGrowthPct: clientRiskProfiles.requiredGrowthPct,
      updatedAt: clientRiskProfiles.updatedAt,
    })
    .from(clients)
    .innerJoin(crmHouseholds, eq(crmHouseholds.id, clients.crmHouseholdId))
    .leftJoin(clientRiskProfiles, eq(clientRiskProfiles.clientId, clients.id))
    .where(and(...conditions));

  return rows.map((r) => ({
    ...r,
    bindingConstraint: r.bindingConstraint ?? "none",
    environmentAdj: r.environmentAdj ?? 0,
  }));
}

const label = (l: RiskLevel | null): string =>
  l ? RISK_LEVEL_LABELS[l] : "none";

/** One human sentence per history row. The reasoning is appended verbatim --
 *  it is the advisor's own words and the reason the record exists. */
export function summarizeEvent(e: {
  kind: RiskProfileEventKind;
  beforeLevel: RiskLevel | null;
  afterLevel: RiskLevel | null;
  reason: string | null;
}): string {
  const from = label(e.beforeLevel);
  const to = label(e.afterLevel);
  switch (e.kind) {
    case "profile_created":
      return `Risk profile created - set to ${to}`;
    case "rtq_completed":
      return `Risk tolerance questionnaire completed - profile set to ${to}`;
    case "tolerance_manual":
      return `Tolerance set manually from ${from} to ${to}${e.reason ? ` - ${e.reason}` : ""}`;
    case "environment_changed":
      return `Environmental factors updated from ${from} to ${to}${e.reason ? ` - ${e.reason}` : ""}`;
    case "capacity_changed":
      return `Planning change moved the profile from ${from} to ${to}`;
  }
}

/**
 * A null actorUserId means the event was never attributed to a person: an
 * RTQ the client submitted themselves, or a system-driven capacity
 * recompute. Distinguish the two rather than collapsing both to "System" --
 * a client's own answers are not a system action.
 */
export function nullActorLabel(kind: RiskProfileEventKind): string {
  return kind === "rtq_completed" ? "Client" : "System";
}

/**
 * RiskListRow is missing three values the detail page renders (spouse
 * tolerance, when capacity was last computed, and the environment
 * reasoning). Extending it here -- rather than widening RiskListRow itself --
 * keeps the list page and its DB-backed scoping test on the twelve-column
 * shape they were built and tested against.
 */
export interface RiskDetailRow extends RiskListRow {
  spouseToleranceScore: number | null;
  capacityComputedAt: Date | null;
  environmentReason: string | null;
}

/** A currently-live emailed link -- status "sent", not yet submitted/expired. */
export interface PendingRtq {
  subject: "primary" | "spouse";
  sentAt: Date | null;
  expiresAt: Date | null;
}

/** Prefill source for the send-questionnaire dialog: the household's CRM
 *  contact for that subject, if one exists. */
export interface RtqContact {
  firstName: string;
  lastName: string;
  email: string | null;
}

export interface RiskDetail {
  row: RiskDetailRow;
  flags: RiskListFlags;
  events: ClientRiskProfileEventRow[];
  unreviewedNotes: Array<{ id: string; note: string; submittedAt: Date | null }>;
  /** Currently-open ("sent") emailed questionnaires, one entry per subject at
   *  most (the send route expires the prior one before inserting a new row).
   *  Sibling field rather than a column on RiskDetailRow -- see the note on
   *  RiskDetailRow above about keeping that shape frozen. */
  pendingRtqs: PendingRtq[];
  /** The household's primary/spouse CRM contacts, keyed by subject -- null
   *  when that role has no contact on the household. */
  contacts: { primary: RtqContact | null; spouse: RtqContact | null };
}

/**
 * Everything the household risk detail page needs for one client. This is a
 * single-client read gated by `requireClientAccess` (ownership / admin / silo
 * / cross-org share) -- not a book-scoped list, so the advisor-visibility
 * machinery `listRiskProfiles` uses does not apply here.
 */
export async function getRiskProfileDetail(clientId: string): Promise<RiskDetail> {
  const { firmId } = await requireClientAccess(clientId);

  const [profileRow] = await db
    .select({
      clientId: clients.id,
      householdName: crmHouseholds.name,
      compositeScore: clientRiskProfiles.compositeScore,
      compositeLevel: clientRiskProfiles.compositeLevel,
      bindingConstraint: clientRiskProfiles.bindingConstraint,
      toleranceScore: clientRiskProfiles.toleranceScore,
      toleranceSource: clientRiskProfiles.toleranceSource,
      toleranceConfirmedAt: clientRiskProfiles.toleranceConfirmedAt,
      capacityScore: clientRiskProfiles.capacityScore,
      environmentAdj: clientRiskProfiles.environmentAdj,
      requiredGrowthPct: clientRiskProfiles.requiredGrowthPct,
      updatedAt: clientRiskProfiles.updatedAt,
      spouseToleranceScore: clientRiskProfiles.spouseToleranceScore,
      capacityComputedAt: clientRiskProfiles.capacityComputedAt,
      environmentReason: clientRiskProfiles.environmentReason,
      // Only used to thread the contacts read below -- destructured out
      // before `row` is built so it never lands on RiskDetailRow's shape.
      crmHouseholdId: clients.crmHouseholdId,
    })
    .from(clients)
    .innerJoin(crmHouseholds, eq(crmHouseholds.id, clients.crmHouseholdId))
    .leftJoin(clientRiskProfiles, eq(clientRiskProfiles.clientId, clients.id))
    .where(and(eq(clients.id, clientId), eq(clients.firmId, firmId)));

  // requireClientAccess already proved the client exists and is visible to
  // the caller -- a missing row here means its household was deleted out
  // from under an otherwise-valid client, not a normal state.
  if (!profileRow) {
    throw new Error(`No household found for client ${clientId}`);
  }

  const { crmHouseholdId, ...detailFields } = profileRow;

  const row: RiskDetailRow = {
    ...detailFields,
    bindingConstraint: detailFields.bindingConstraint ?? "none",
    environmentAdj: detailFields.environmentAdj ?? 0,
  };

  const [events, noteRows, pendingRtqRows, contactRows] = await Promise.all([
    db
      .select()
      .from(clientRiskProfileEvents)
      .where(
        and(
          eq(clientRiskProfileEvents.clientId, clientId),
          eq(clientRiskProfileEvents.firmId, firmId),
        ),
      )
      .orderBy(desc(clientRiskProfileEvents.occurredAt))
      .limit(50),
    db
      .select({
        id: riskQuestionnaires.id,
        note: riskQuestionnaires.environmentNote,
        submittedAt: riskQuestionnaires.submittedAt,
      })
      .from(riskQuestionnaires)
      .where(
        and(
          eq(riskQuestionnaires.clientId, clientId),
          eq(riskQuestionnaires.firmId, firmId),
          isNotNull(riskQuestionnaires.environmentNote),
          isNull(riskQuestionnaires.environmentNoteReviewedAt),
        ),
      ),
    db
      .select({
        subject: riskQuestionnaires.subject,
        sentAt: riskQuestionnaires.sentAt,
        expiresAt: riskQuestionnaires.expiresAt,
      })
      .from(riskQuestionnaires)
      .where(
        and(
          eq(riskQuestionnaires.clientId, clientId),
          eq(riskQuestionnaires.firmId, firmId),
          eq(riskQuestionnaires.status, "sent"),
        ),
      ),
    db
      .select({
        role: crmHouseholdContacts.role,
        firstName: crmHouseholdContacts.firstName,
        lastName: crmHouseholdContacts.lastName,
        email: crmHouseholdContacts.email,
      })
      .from(crmHouseholdContacts)
      .where(
        and(
          eq(crmHouseholdContacts.householdId, crmHouseholdId),
          inArray(crmHouseholdContacts.role, ["primary", "spouse"]),
        ),
      ),
  ]);

  // The two partial unique indexes on crm_household_contacts (one primary,
  // one spouse per household) guarantee at most one row per bucket here.
  const contacts: RiskDetail["contacts"] = { primary: null, spouse: null };
  for (const c of contactRows) {
    const contact: RtqContact = { firstName: c.firstName, lastName: c.lastName, email: c.email };
    if (c.role === "primary") contacts.primary = contact;
    else if (c.role === "spouse") contacts.spouse = contact;
  }

  return {
    row,
    flags: deriveListFlags(row, new Date()),
    events,
    // isNotNull(environmentNote) guarantees `note` is a string; the cast
    // documents that rather than re-deriving it from the filter.
    unreviewedNotes: noteRows.map((n) => ({
      id: n.id,
      note: n.note as string,
      submittedAt: n.submittedAt,
    })),
    pendingRtqs: pendingRtqRows,
    contacts,
  };
}
