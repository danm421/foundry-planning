// src/lib/fact-finder/placement/validate.ts
/**
 * Every Create and Update line through the Details write path's own checks
 * (D9): the line's body (payloadFor, placeholder ids) against the route's zod
 * schema, the first problem becoming the line's `blocked` reason in the
 * advisor's words, with the cell to fix.
 *
 * SERVER-SIDE ONLY: the route schemas import `next/server` (schemas/common.ts).
 * Never import this from a client component (server-only makes the build say so).
 */
import "server-only";
import type { z } from "zod";
import { findField } from "@/domain/forge/detail-fields";
import { validatePlanSettingsPatch } from "@/lib/plan-settings/validate-patch";
import { accountCreateSchema, accountUpdateSchema } from "@/lib/schemas/accounts";
import { AddBusinessInputSchema } from "@/lib/schemas/accounts-business";
import { annuityContractSchema } from "@/lib/schemas/annuities";
import { beneficiarySetSchema, externalBeneficiaryCreateSchema, externalBeneficiaryUpdateSchema } from "@/lib/schemas/beneficiaries";
import { clientProfileUpdateSchema } from "@/lib/schemas/client-profile";
import { disabilityPolicyCreateSchema, disabilityPolicyUpdateSchema } from "@/lib/schemas/disability-policies";
import { entityCreateSchema, entityUpdateSchema } from "@/lib/schemas/entities";
import { expenseCreateSchema, expenseUpdateSchema } from "@/lib/schemas/expenses";
import { familyMemberCreateSchema } from "@/lib/schemas/family-members";
import { giftCreateSchema, giftUpdateSchema } from "@/lib/schemas/gifts";
import { incomeCreateSchema, incomeUpdateSchema } from "@/lib/schemas/incomes";
import { insurancePolicyCreateSchema, insurancePolicyUpdateSchema } from "@/lib/schemas/insurance-policies";
import { liabilityCreateSchema, liabilityUpdateSchema } from "@/lib/schemas/liabilities";
import { ltcPolicyCreateSchema, ltcPolicyUpdateSchema } from "@/lib/schemas/ltc-policies";
import { noteReceivableCreateSchema, noteReceivableUpdateSchema } from "@/lib/schemas/note-receivable";
import { observationCreateSchema, observationUpdateSchema } from "@/lib/schemas/observations";
import { relatedPartyCreateSchema, relatedPartyUpdateSchema } from "@/lib/schemas/related-parties";
import { revocableTrustUpsertSchema } from "@/lib/schemas/revocable-trusts";
import {
  grantCreateSchema, grantUpdateSchema, stockOptionAccountCreateSchema, stockOptionAccountUpdateSchema,
} from "@/lib/schemas/stock-options";
import { willBequestSchema, willCreateSchema, willUpdateSchema } from "@/lib/schemas/wills";
import { refKey, type CellRef, type ChangeLine, type PlacedValue, type RecordRef, type TargetKind } from "../change-set";
import { lineValues, payloadFor, type Resolve } from "./payload";
import { FACT_FINDER_ONLY, TARGETS, targetField, type ValueKind } from "./targets";
import { formatValue } from "./values";

type Body = Record<string, unknown>;
/** The parts of a zod issue the reasons read; the hand checks below produce the same shape. */
interface Issue {
  code: string;
  path: readonly PropertyKey[];
  message: string;
  origin?: string;
  minimum?: unknown;
  maximum?: unknown;
  inclusive?: boolean;
}
type Check = (body: Body) => Issue[];

const schemaCheck = (schema: z.ZodType) => (input: unknown): Issue[] => {
  const parsed = schema.safeParse(input);
  return parsed.success ? [] : parsed.error.issues;
};
/** A set field: `wrap` turns its rows into what the schema parses; every problem is that field's. */
const setCheck = (key: string, schema: z.ZodType, wrap: (rows: unknown) => unknown = (rows) => rows): Check => (body) =>
  schemaCheck(schema)(wrap(body[key])).map((issue) => ({ ...issue, path: [key] }));
const both = (check: Check) => ({ create: check, update: check });

/** savings-rules-writes.ts has no schema: createSavingsRuleForClient refuses a body without accountId, startYear and endYear. Mirrored here, one issue per key. */
const savingsRuleCreate: Check = (body) =>
  ["accountId", "startYear", "endYear"]
    .filter((key) => !body[key])
    .map((key) => ({ code: "invalid_type", path: [key], message: "Missing required fields" }));

/** validatePlanSettingsPatch returns one message and no path; the reason finds the key it names. */
const planSettings: Check = (body) => {
  const message = validatePlanSettingsPatch(body);
  return message ? [{ code: "custom", path: [], message }] : [];
};

const designations = both(setCheck("beneficiaries", beneficiarySetSchema));

/**
 * The check each route runs. An Update with no schema of its own (a family
 * member's PUT; savings rules) uses the create schema's field rules or nothing.
 */
const CHECKS: Record<TargetKind, { create: Check; update: Check }> = {
  client_household: both(schemaCheck(clientProfileUpdateSchema)),
  plan_settings_tax_rates: both(planSettings),
  family_member: both(schemaCheck(familyMemberCreateSchema)),
  external_beneficiary: { create: schemaCheck(externalBeneficiaryCreateSchema), update: schemaCheck(externalBeneficiaryUpdateSchema) },
  related_party: { create: schemaCheck(relatedPartyCreateSchema), update: schemaCheck(relatedPartyUpdateSchema) },
  account: { create: schemaCheck(accountCreateSchema), update: schemaCheck(accountUpdateSchema) },
  // accountCreateSchema runs AddBusinessInputSchema for a business but reports its issue without a path; run it first for one.
  business_account: {
    create: (body) => [...schemaCheck(AddBusinessInputSchema)(body), ...schemaCheck(accountCreateSchema)(body)],
    update: schemaCheck(accountUpdateSchema),
  },
  account_beneficiary_designation: designations,
  annuity_contract: both(schemaCheck(annuityContractSchema)),
  stock_option_account: { create: schemaCheck(stockOptionAccountCreateSchema), update: schemaCheck(stockOptionAccountUpdateSchema) },
  stock_option_grant: { create: schemaCheck(grantCreateSchema), update: schemaCheck(grantUpdateSchema) },
  note_receivable: { create: schemaCheck(noteReceivableCreateSchema), update: schemaCheck(noteReceivableUpdateSchema) },
  liability: { create: schemaCheck(liabilityCreateSchema), update: schemaCheck(liabilityUpdateSchema) },
  income: { create: schemaCheck(incomeCreateSchema), update: schemaCheck(incomeUpdateSchema) },
  expense: { create: schemaCheck(expenseCreateSchema), update: schemaCheck(expenseUpdateSchema) },
  savings_rule: { create: savingsRuleCreate, update: () => [] },
  life_insurance_policy: { create: schemaCheck(insurancePolicyCreateSchema), update: schemaCheck(insurancePolicyUpdateSchema) },
  life_insurance_policy_beneficiary: designations,
  disability_policy: { create: schemaCheck(disabilityPolicyCreateSchema), update: schemaCheck(disabilityPolicyUpdateSchema) },
  ltc_policy: { create: schemaCheck(ltcPolicyCreateSchema), update: schemaCheck(ltcPolicyUpdateSchema) },
  entity: { create: schemaCheck(entityCreateSchema), update: schemaCheck(entityUpdateSchema) },
  trust_beneficiary_designation: designations,
  revocable_trust: both(schemaCheck(revocableTrustUpsertSchema)),
  will: { create: schemaCheck(willCreateSchema), update: schemaCheck(willUpdateSchema) },
  will_bequest: both(schemaCheck(willBequestSchema)),
  // The rows travel in the will's PUT, whose schema sums each tier.
  will_residuary_recipient: both(setCheck("recipients", willUpdateSchema, (rows) => ({ residuaryRecipients: rows }))),
  gift: { create: schemaCheck(giftCreateSchema), update: schemaCheck(giftUpdateSchema) },
  plan_observation: { create: schemaCheck(observationCreateSchema), update: schemaCheck(observationUpdateSchema) },
};

const PEOPLE_KINDS: ReadonlySet<ValueKind> = new Set(["owners", "beneficiaries", "recipients"]);
const SAME_ONE: Partial<Record<TargetKind, string>> = { entity: "the same trust", external_beneficiary: "the same charity or beneficiary" };

/**
 * Blocks each Create and Update line the Details write path would refuse:
 * the same person named twice in a people list, then the route's own check.
 * `columnFeeding` names the column that feeds a key, for a required value
 * the line doesn't have.
 */
export function validateLines(
  lines: readonly ChangeLine[],
  columnFeeding: (line: ChangeLine, key: string) => string | undefined,
): ChangeLine[] {
  const labels = new Map(lines.map((l) => [l.id, l.label]));
  return lines.map((line) => {
    if (line.action === "none" || line.blocked) return line;
    const blocked = namedTwice(line, labels) ?? schemaProblem(line, columnFeeding);
    return blocked ? { ...line, blocked } : line;
  });
}

/** Two entries with the same who (and, for beneficiaries, the same tier): sharesOf doesn't refuse "Emma 50%, Emma Hendricks 50%". */
function namedTwice(line: ChangeLine, labels: ReadonlyMap<string, string>): ChangeLine["blocked"] {
  for (const field of line.fields) {
    if (!PEOPLE_KINDS.has(targetField(line.target, field.key)?.kind as ValueKind)) continue;
    const seen = new Set<string>();
    for (const entry of field.next as { who: RecordRef; tier?: string }[]) {
      const key = `${entry.tier ?? ""}|${refKey(entry.who)}`;
      if (seen.has(key)) {
        return { reason: `${field.label}: names ${whoLabel(entry.who, labels)} twice.`, ...cellOf(field.from[0]) };
      }
      seen.add(key);
    }
  }
  return undefined;
}

function whoLabel(who: RecordRef, labels: ReadonlyMap<string, string>): string {
  if (who.ref === "person") return who.role === "client" ? "the client" : "the co-client";
  if (who.ref === "line" && labels.has(who.lineId)) return labels.get(who.lineId)!;
  return SAME_ONE[who.target] ?? "the same person";
}

/** A distinct well-formed UUID per ref, and this year for every milestone. */
function placeholders(): Resolve {
  const ids = new Map<string, string>();
  return {
    id(ref) {
      const key = refKey(ref);
      if (!ids.has(key)) ids.set(key, `00000000-0000-4000-8000-${String(ids.size + 1).padStart(12, "0")}`);
      return ids.get(key)!;
    },
    year: () => new Date().getFullYear(),
  };
}

function schemaProblem(
  line: ChangeLine,
  columnFeeding: (line: ChangeLine, key: string) => string | undefined,
): ChangeLine["blocked"] {
  const action = line.action as "create" | "update";
  const body = payloadFor(line.target, lineValues(line), placeholders());
  for (const issue of CHECKS[line.target][action](body)) {
    const payloadKey = keyOf(issue, line.target, body);
    const present = payloadKey !== undefined && body[payloadKey] !== undefined;
    // An Update sends only what changed, so a key it doesn't send isn't missing — the record has it. A cross-field
    // rule (custom) still counts: the edit route runs the same schema on the request alone.
    if (action === "update" && payloadKey !== undefined && !present && issue.code !== "custom") continue;
    const key = payloadKey === undefined ? undefined : targetKeyOf(line.target, payloadKey);
    const spec = key === undefined ? undefined : targetField(line.target, key);
    const label = spec?.label ?? detailsLabel(line.target, payloadKey);
    const field = key === undefined ? undefined : line.fields.find((f) => f.key === key);
    const column = key === undefined ? undefined : columnFeeding(line, key);
    const cell = field?.from[0] ?? (column ? { sectionId: line.sectionId, rowId: line.rowId, columnId: column } : undefined);
    return { reason: reasonFor(issue, label, present, payloadKey, spec?.kind), ...cellOf(cell) };
  }
  return undefined;
}

function cellOf(cell: CellRef | undefined): { cell?: CellRef } {
  return cell ? { cell } : {};
}

/** The payload key an issue is about: its path's first key, else the first key its message names. */
function keyOf(issue: Issue, target: TargetKind, body: Body): string | undefined {
  const first = issue.path[0];
  if (typeof first === "string") return first;
  const candidates = new Set([...Object.keys(body), ...Object.keys(TARGETS[target].fields), ...expansionKeys(target)]);
  let best: { key: string; at: number } | undefined;
  for (const key of candidates) {
    const at = issue.message.search(new RegExp(`\\b${key}\\b`));
    if (at >= 0 && (!best || at < best.at)) best = { key, at };
  }
  return best?.key;
}

function expansionKeys(target: TargetKind): string[] {
  return Object.entries(FACT_FINDER_ONLY)
    .filter(([path]) => path.startsWith(`${target}.`))
    .flatMap(([, { expandsTo }]) => expandsTo);
}

/** The catalog key a payload key came from: itself, or the composite that expands into it (startYear → start). */
function targetKeyOf(target: TargetKind, payloadKey: string): string | undefined {
  if (targetField(target, payloadKey)) return payloadKey;
  const composite = Object.entries(FACT_FINDER_ONLY).find(
    ([path, { expandsTo }]) => path.startsWith(`${target}.`) && expandsTo.includes(payloadKey),
  );
  return composite?.[0].slice(target.length + 1);
}

/** A fixed key's Details label ("Category", "Section"), else the record's own label. */
function detailsLabel(target: TargetKind, payloadKey: string | undefined): string {
  const label = payloadKey === undefined ? undefined : findField(target, payloadKey)?.label;
  return label && !label.startsWith("(") ? label : TARGETS[target].label;
}

/** The issue in plain words. Zod's own wording ("expected string, received undefined") never reaches the advisor. */
function reasonFor(issue: Issue, label: string, present: boolean, payloadKey: string | undefined, kind: ValueKind | undefined): string {
  const emptyText = issue.code === "too_small" && (issue.origin === "string" || issue.origin === "array");
  if ((!present && issue.code !== "custom") || emptyText) return `Needs ${label}.`;
  switch (issue.code) {
    case "custom":
      // A route's own sentence reads well; one that names payload keys ("expirationDate is required for nqso/iso grants.") doesn't.
      if (!namesKeys(issue.message, payloadKey)) return `${label}: ${sentence(issue.message)}`;
      return /\brequired\b|must be set/i.test(issue.message) ? `Needs ${label}.` : `${label}: this value can't be saved.`;
    case "invalid_value":
      return `${label}: pick one of the options.`;
    case "too_small":
      return `${label}: must be ${issue.inclusive ? `${bound(issue.minimum, kind)} or more` : `more than ${bound(issue.minimum, kind)}`}.`;
    case "too_big":
      return `${label}: must be ${issue.inclusive ? `${bound(issue.maximum, kind)} or less` : `less than ${bound(issue.maximum, kind)}`}.`;
    default:
      return `${label}: this value can't be saved.`;
  }
}

function namesKeys(message: string, payloadKey: string | undefined): boolean {
  return /\b[a-z]+[A-Z]\w*/.test(message) || (payloadKey !== undefined && new RegExp(`\\b${payloadKey}\\b`).test(message));
}

/** "Must be zero or more" → "must be zero or more." (an acronym keeps its capitals). */
function sentence(message: string): string {
  const text = /^[A-Z](?![A-Z])/.test(message) ? message.charAt(0).toLowerCase() + message.slice(1) : message;
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

/** A bound in the field's units: 0.2 on a rate is 20%. */
function bound(value: unknown, kind: ValueKind | undefined): string {
  const n = Number(value);
  return kind === "money" || kind === "rate" || kind === "percent"
    ? formatValue(kind, n as PlacedValue, { labelOf: () => "" })
    : String(n);
}
