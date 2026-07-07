/**
 * Canonical create / update / delete / other classification for an audit
 * `action` string (e.g. "income.create", "crm.household.soft_delete").
 *
 * This is the single source of truth used by BOTH the activity filter (which
 * turns a target kind into a SQL predicate on `action`) and the row renderer
 * (glyph + body). Deriving the kind from the action string — rather than from
 * `metadata.kind` — matters because only the `recordCreate/Update/Delete`
 * helpers stamp `metadata.kind`; the many call sites that use `recordAudit`
 * directly (income/expense/account/liability writes, etc.) do not. Keying on
 * the action makes classification work for 100% of rows.
 */

export type ActionKind = "create" | "update" | "delete" | "other";

/**
 * Trailing verb segments that map to each concrete kind. Anything else is
 * "other". Kept as data so the SQL predicate in `buildActivityWhere` stays in
 * lockstep with `deriveActionKind`.
 */
export const ACTION_KIND_SUFFIXES: Record<
  Exclude<ActionKind, "other">,
  readonly string[]
> = {
  create: ["create"],
  update: ["update", "upsert", "replace"],
  delete: ["delete", "soft_delete", "hard_delete"],
};

/** The last dot-delimited segment of an action, e.g. "a.b.create" → "create". */
export function actionVerb(action: string): string {
  const dot = action.lastIndexOf(".");
  return dot === -1 ? action : action.slice(dot + 1);
}

export function deriveActionKind(action: string): ActionKind {
  const verb = actionVerb(action);
  for (const kind of ["create", "update", "delete"] as const) {
    if (ACTION_KIND_SUFFIXES[kind].includes(verb)) return kind;
  }
  return "other";
}
