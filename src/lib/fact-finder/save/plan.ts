// src/lib/fact-finder/save/plan.ts
/**
 * The save plan (D5, D8): the advisor's ticks over the change list decide which
 * lines the save writes and which it leaves out — a line with nothing ticked,
 * a line that names the co-client nobody is adding, a new record whose Owner
 * isn't ticked on a plan with a co-client, and every line that needs a line
 * left out, each with its reason — and the order the written lines go in. The
 * server plans the save with it; the change list runs it to show what
 * unticking leaves out.
 *
 * Client-safe and pure. Type-only imports from save/types.ts (it holds server
 * code too).
 */
import { isRecordRef, type ChangeLine, type ChangeSet, type ChangeTicks, type PlacedValue, type RecordRef, type TargetKind } from "../change-set";
import { lineValues } from "../placement/payload";
import { targetField } from "../placement/targets";
import type { LeftOutLine, PlannedLine } from "./types";

/** D8: the household first (it adds the co-client), charities before what they own or receive, an annuity's account before its contract. */
export const TARGET_ORDER: readonly TargetKind[] = [
  "client_household", "plan_settings_tax_rates", "family_member", "external_beneficiary", "related_party", "entity",
  "business_account", "account", "annuity_contract", "stock_option_account", "stock_option_grant", "note_receivable",
  "revocable_trust", "liability", "income", "expense", "savings_rule", "life_insurance_policy", "disability_policy",
  "ltc_policy", "account_beneficiary_designation", "life_insurance_policy_beneficiary", "trust_beneficiary_designation",
  "will", "will_bequest", "will_residuary_recipient", "gift", "plan_observation",
];

export type SavePlan =
  | { ok: true; lines: PlannedLine[]; leftOut: LeftOutLine[] }
  | { ok: false; error: string };

const TICKS_MISMATCH = "The ticks don't match this change list — review again.";
const NOTHING_TICKED = "Nothing ticked.";
const NEEDS_CO_CLIENT = "Needs the co-client, who isn't being saved.";
const OWNER_UNTICKED = "Who owns it isn't ticked.";
const needsLine = (label: string) => `Needs “${label}”, which isn't being saved.`;

/**
 * Plans the save of `changeSet` with the advisor's `ticks` (unchecked: the request's). Refused unless the ticks
 * have an entry for exactly the lines that can save — create and update lines that aren't blocked — each with a
 * true or false for exactly its fields. `hasCoClient`: the plan has the co-client's family member.
 */
export function planSave(changeSet: ChangeSet, ticks: unknown, opts: { hasCoClient: boolean }): SavePlan {
  const open = changeSet.lines.filter((l) => l.action !== "none" && !l.blocked);
  if (!ticksMatch(open, ticks)) return { ok: false, error: TICKS_MISMATCH };
  const all = open.map((line) => planned(line, ticks[line.id]));
  const needs = new Map(all.map((p) => [p.line.id, needsOf(p)]));
  const labels = new Map(changeSet.lines.map((l) => [l.id, l.label]));

  const reasons = new Map<string, string>();
  const writing = () => all.filter((p) => !reasons.has(p.line.id));
  for (const p of all) if (!p.line.fields.some((f) => f.ticked)) reasons.set(p.line.id, NOTHING_TICKED);
  // A co-client the plan doesn't have exists only once a household line writes their first name.
  const addsCoClient = writing().some((p) => p.line.target === "client_household" && p.line.fields.some((f) => f.key === "spouseName" && f.ticked));
  if (opts.hasCoClient || addsCoClient) {
    for (const p of writing()) if (ownerUnticked(p)) reasons.set(p.line.id, OWNER_UNTICKED);
  } else {
    for (const p of writing()) if (namesCoClient(p)) reasons.set(p.line.id, NEEDS_CO_CLIENT);
  }
  // Pass after pass: a line left out in one pass leaves out the lines that need it in the next.
  for (let changed = true; changed; ) {
    changed = false;
    const written = new Set(writing().map((p) => p.line.id));
    for (const p of writing()) {
      const missing = needs.get(p.line.id)?.find((id) => !written.has(id));
      if (missing === undefined) continue;
      reasons.set(p.line.id, needsLine(labels.get(missing) ?? "another row"));
      changed = true;
    }
  }

  return {
    ok: true,
    lines: saveOrder(writing(), needs),
    leftOut: all.flatMap(({ line }) => {
      const reason = reasons.get(line.id);
      return reason === undefined ? [] : [{ lineId: line.id, rowId: line.rowId, label: line.label, reason }];
    }),
  };
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** An object whose own keys are exactly `keys`. */
function hasExactly(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!isObject(value)) return false;
  const own = new Set(Object.keys(value));
  return own.size === new Set(keys).size && keys.every((k) => own.has(k));
}

function ticksMatch(open: readonly ChangeLine[], ticks: unknown): ticks is ChangeTicks {
  if (!hasExactly(ticks, open.map((l) => l.id))) return false;
  return open.every((line) => {
    const lineTicks = ticks[line.id];
    return hasExactly(lineTicks, line.fields.map((f) => f.key)) && Object.values(lineTicks).every((t) => typeof t === "boolean");
  });
}

/** The line with each field ticked as the advisor left it, and what it writes. */
function planned(line: ChangeLine, ticks: Record<string, boolean>): PlannedLine {
  return { line: { ...line, fields: line.fields.map((f) => ({ ...f, ticked: ticks[f.key] })) }, values: lineValues(line, ticks) };
}

/** Every ref inside a value. */
function refsIn(value: PlacedValue): RecordRef[] {
  if (isRecordRef(value)) return [value];
  if (Array.isArray(value)) return value.flatMap(refsIn);
  if (value !== null && typeof value === "object") return Object.values(value).flatMap(refsIn);
  return [];
}

/** The lines a planned line can't save without: a line it refers to in what it writes, and a line it hangs off. */
function needsOf({ line, values }: PlannedLine): string[] {
  return [
    ...refsIn(Object.values(values)).flatMap((ref) => (ref.ref === "line" ? [ref.lineId] : [])),
    ...(line.parent?.ref === "line" ? [line.parent.lineId] : []),
  ];
}

/**
 * Choices that mean the co-client or both of them: an owner, the insured, a will's or gift's maker, who pays, a
 * grantor, when a trust ends, a will provision that turns on whether they survive.
 */
const CO_CLIENT_CHOICES: ReadonlySet<PlacedValue> = new Set(["spouse", "joint", "both", "spouse_death", "if_spouse_survives", "if_spouse_predeceased"]);

/**
 * What a line writes names the co-client: a person ref to them (owners, beneficiaries, recipients…), a choice
 * that means them, a year at one of their milestones, or one of their own household or tax-settings fields.
 */
function namesCoClient({ line, values }: PlannedLine): boolean {
  return Object.entries(values).some(([key, value]) => {
    if (refsIn(value).some((ref) => ref.ref === "person" && ref.role === "spouse")) return true;
    if ((line.target === "client_household" || line.target === "plan_settings_tax_rates") && key.startsWith("spouse")) return true;
    const kind = targetField(line.target, key)?.kind;
    if (kind === "choice" || kind === "policyOwner") return CO_CLIENT_CHOICES.has(value);
    return kind === "timing" && isObject(value) && String((value as { yearRef?: PlacedValue }).yearRef).startsWith("spouse_");
  });
}

/**
 * Each target whose review blocks a new record's blank Owner when the plan has a co-client (helpers.ts ownersOf;
 * the note, business and stock option maps block a blank one on every new record), and that Owner's field.
 */
const OWNER_FIELD: Partial<Record<TargetKind, string>> = {
  account: "owners", liability: "owners", life_insurance_policy: "ownerRef",
  note_receivable: "owners", business_account: "owners", stock_option_account: "owner",
};

/** A Create with its Owner unticked: with a co-client, it would be saved as the client's alone (or refused). */
function ownerUnticked({ line }: PlannedLine): boolean {
  const key = OWNER_FIELD[line.target];
  return line.action === "create" && line.fields.some((f) => f.key === key && !f.ticked);
}

/** By target rank, then change-set order; a line that needs a later line goes after it. */
function saveOrder(lines: readonly PlannedLine[], needs: ReadonlyMap<string, string[]>): PlannedLine[] {
  const rank = (p: PlannedLine) => TARGET_ORDER.indexOf(p.line.target);
  const pending = [...lines].sort((a, b) => rank(a) - rank(b));
  const done = new Set<string>();
  const ordered: PlannedLine[] = [];
  while (pending.length > 0) {
    // The first line whose needs are all placed; lines that need each other keep rank order.
    const ready = pending.findIndex((p) => (needs.get(p.line.id) ?? []).every((id) => done.has(id)));
    const [next] = pending.splice(Math.max(ready, 0), 1);
    ordered.push(next);
    done.add(next.line.id);
  }
  return ordered;
}
