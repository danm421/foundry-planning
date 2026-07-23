import { db } from "@/db";
import { staffAdvisorVisibility } from "@/db/schema";
import { and, eq, inArray, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { STAFF_ROLES } from "./capabilities";
import { firmBookSiloEnabled } from "./firm-settings";

// Sentinel for firm-wide visibility (admin). Distinct from a Set so callers can
// cheaply branch on `=== VISIBLE_ALL` and skip scoping entirely.
export const VISIBLE_ALL = "ALL" as const;
export type VisibleAdvisors = typeof VISIBLE_ALL | Set<string>;

const FIRM_WIDE_ROLES = new Set<string>(["org:owner", "org:admin"]);

/**
 * True only for roles that are administratively firm-wide (admin/owner) — the
 * SAME set `resolveVisibleAdvisorIds` uses to short-circuit to `VISIBLE_ALL`.
 *
 * This is intentionally narrower than "caller's resolved visibility is
 * VISIBLE_ALL": a regular `org:member` in a non-siloed firm ALSO resolves to
 * VISIBLE_ALL (see resolveVisibleAdvisorIds), but has not opted into any
 * book-switcher UI. Callers MUST gate `narrowToAdvisor` on this role check —
 * NEVER on `visible === VISIBLE_ALL` — or a non-admin member's scope could be
 * replaced (not narrowed) by a client-supplied advisor id. See narrowToAdvisor.
 */
export function isFirmWideAdminRole(orgRole: string | null | undefined): boolean {
  return !!orgRole && FIRM_WIDE_ROLES.has(orgRole);
}

/**
 * The set of advisorIds whose book the caller may see.
 * - Admin/owner → VISIBLE_ALL (never scoped).
 * - Staff (operations/planner) → their staff_advisor_visibility mapping.
 * - Advisor (org:member): VISIBLE_ALL when the firm is NOT siloed (legacy); when
 *   siloed → { self } only. Access to OTHER advisors' books (via share-all or
 *   per-client shares) is resolved separately through resolveSharedClientAccess /
 *   the sharedIds union — that path carries the correct view/edit permission and
 *   excludes isPrivate clients, which this coarse advisor-set filter cannot.
 */
export async function resolveVisibleAdvisorIds(
  userId: string,
  orgRole: string | null | undefined,
  firmId: string,
): Promise<VisibleAdvisors> {
  if (orgRole && FIRM_WIDE_ROLES.has(orgRole)) return VISIBLE_ALL;

  if (orgRole && STAFF_ROLES.has(orgRole)) {
    const rows = await db
      .select({ advisorUserId: staffAdvisorVisibility.advisorUserId })
      .from(staffAdvisorVisibility)
      .where(
        and(
          eq(staffAdvisorVisibility.firmId, firmId),
          eq(staffAdvisorVisibility.staffUserId, userId),
        ),
      );
    return new Set(rows.map((r) => r.advisorUserId));
  }

  // org:member (advisor) and any other non-firm-wide role.
  if (!(await firmBookSiloEnabled(firmId))) return VISIBLE_ALL;
  if (!userId) return new Set<string>();
  return new Set<string>([userId]);
}

/**
 * Turn a VisibleAdvisors result into a Drizzle WHERE condition over an advisorId
 * column. VISIBLE_ALL → undefined (no filter). Empty set → `false` (match
 * nothing). Otherwise → `advisorId IN (...)`.
 */
export function advisorScopeCondition(
  column: AnyColumn,
  visible: VisibleAdvisors,
): SQL | undefined {
  if (visible === VISIBLE_ALL) return undefined;
  const ids = [...visible];
  if (ids.length === 0) return sql`false`;
  return inArray(column, ids);
}

/**
 * Admin book-switcher helper: collapse any visibility (including VISIBLE_ALL) to
 * a single chosen advisor's book. Used only after an admin picks one advisor.
 *
 * SECURITY: this REPLACES the input set for ANY input, including VISIBLE_ALL.
 * Callers MUST gate every call site on `isFirmWideAdminRole(orgRole)` first —
 * calling this for a non-admin (e.g. a siloed member's `{self}`) would widen
 * their access to whatever advisorId the client sent.
 */
export function narrowToAdvisor(
  _visible: VisibleAdvisors,
  advisorId: string,
): VisibleAdvisors {
  return new Set<string>([advisorId]);
}

/**
 * Sentinel the book-switcher URL param normalizes to "no narrowing". The
 * switcher's own "All clients" option deletes the `?advisor=` key entirely,
 * but the contract also allows the literal string `"all"` (hand-typed,
 * bookmarked, or written by some future caller that sets the key instead of
 * deleting it) to mean the same thing. See `applyBookSwitcher` for why that
 * second form must be normalized centrally rather than left to each caller.
 */
export const ALL_BOOKS = "all" as const;

/**
 * Single normalized gate for the four call sites that apply the admin
 * book-switcher's `viewAsAdvisorId` narrowing (`listCrmHouseholds`,
 * `listRecentlyOpenedHouseholds`, `visibleHouseholdConditions`, and
 * `GET /api/clients`). Each previously duplicated:
 *
 * ```ts
 * if (viewAsAdvisorId && isFirmWideAdminRole(orgRole)) {
 *   visible = narrowToAdvisor(visible, viewAsAdvisorId);
 * }
 * ```
 *
 * which has an empty-list trap: it treats ANY non-empty string as "narrow",
 * including the literal sentinel `"all"`. The book switcher deletes the URL
 * param for "All clients" today, so `"all"` never occurs in practice — but a
 * hand-typed `?advisor=all`, a bookmarked URL, or a future caller that sets
 * the param instead of deleting it would hit the gate as a truthy string,
 * flow into `narrowToAdvisor(visible, "all")`, and produce `Set(["all"])` →
 * `advisorId IN ('all')`, which matches no household. The admin who asked to
 * see "all clients" would silently get an EMPTY list instead. Normalizing
 * `ALL_BOOKS` (and empty/missing) to "no narrowing" here, once, closes that
 * trap for every caller instead of relying on four call sites to each
 * remember it.
 *
 * Otherwise unchanged from the duplicated gate: only admins/owners
 * (`isFirmWideAdminRole`) may narrow, and `narrowToAdvisor` is the only thing
 * that performs the narrowing — see its SECURITY docblock above, which still
 * applies unchanged (this helper is just the one place that decides whether
 * to call it).
 */
export function applyBookSwitcher(
  visible: VisibleAdvisors,
  orgRole: string | null | undefined,
  viewAsAdvisorId: string | null | undefined,
): VisibleAdvisors {
  if (!viewAsAdvisorId || viewAsAdvisorId === ALL_BOOKS) return visible;
  if (!isFirmWideAdminRole(orgRole)) return visible;
  return narrowToAdvisor(visible, viewAsAdvisorId);
}
