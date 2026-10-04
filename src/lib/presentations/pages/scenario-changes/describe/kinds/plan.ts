import { USPS_STATE_NAMES, isUSPSStateCode } from "@/lib/usps-states";
import { editRow, addRow, removeRow } from "../generic";
import { nameFor, fieldLabel, fmtFieldValue } from "../format";
import { toNum } from "../labels";
import {
  GROWTH_FIELD_LABELS,
  GROWTH_PERCENT_KEYS,
  growthEnumLabel,
  isGrowthModelPortfolioKey,
} from "@/lib/scenario/growth-field-labels";
import { SPEC } from "../specs";
import { DESCRIBERS, simpleDescriber, type Describer } from "../registry";
import { stressTestSchema } from "@/lib/schemas/stress-test";
import { stressTestDetail } from "@/lib/stress-tests/describe";

const ASSUMPTION_LINE: Record<string, (to: unknown) => string> = {
  retirementAge: (to) => `Client retires at ${to}`,
  spouseRetirementAge: (to) => `Co-client retires at ${to}`,
  lifeExpectancy: (to) => `Plan to client age ${to}`,
  spouseLifeExpectancy: (to) => `Plan to Co-client age ${to}`,
};

const client: Describer = (c, ctx) => {
  const row = editRow(c, { ...SPEC.client }, nameFor(c, ctx.targetNames) ?? "Client profile");
  const payload = (c.payload ?? {}) as Record<string, { to: unknown }>;
  const fields = Object.keys(payload);
  if (fields.length === 1 && ASSUMPTION_LINE[fields[0]]) {
    row.detail = [ASSUMPTION_LINE[fields[0]](payload[fields[0]].to)];
  }
  return row;
};

/** A fraction as a percent to two decimals ("7%", "2.5%", "3.25%"); `pct`'s one
 *  decimal would turn 0.07 into "7.0%" and 3.25% into "3.3%". */
const ratePct = (v: unknown): string => {
  const n = toNum(v);
  return n == null ? "—" : `${Number((n * 100).toFixed(2))}%`;
};

/** Growth & Inflation keys read by name, rates as percents, enum choices as
 *  words and a portfolio by its name — never a raw key, fraction or uuid. */
const planSettings: Describer = (c, ctx) =>
  editRow(c, { ...SPEC.plan_settings }, nameFor(c, ctx.targetNames) ?? "Plan assumption", {
    label: (f) => GROWTH_FIELD_LABELS[f] ?? fieldLabel(f),
    value: (f, v) => {
      if (isGrowthModelPortfolioKey(f)) {
        return v == null ? "None" : (ctx.resolve.modelPortfolio(String(v))?.name ?? "A model portfolio");
      }
      if (GROWTH_PERCENT_KEYS.has(f)) return ratePct(v);
      return growthEnumLabel(f, v) ?? fmtFieldValue(f, v);
    },
  });

const familyMember = simpleDescriber({
  area: "Plan & Assumptions", noun: "family member", whatMode: "name",
  segments: [(p) => (typeof p.relationship === "string" ? String(p.relationship).replace(/_/g, " ") : null)],
});

const withdrawalStrategy: Describer = (c) => {
  if (c.opType === "add") return addRow("Plan & Assumptions", "Withdrawal strategy", ["Sets the account draw-down order"]);
  if (c.opType === "remove") return removeRow("Plan & Assumptions", "Withdrawal strategy", ["Reverts to default draw-down order"]);
  return editRow(c, { ...SPEC.withdrawal_strategy }, "Withdrawal strategy");
};

/** USPS code → full state name; passes any other non-empty string through. */
const stateName = (code: unknown): string | null => {
  if (isUSPSStateCode(code)) return USPS_STATE_NAMES[code];
  return typeof code === "string" && code.trim() ? code : null;
};

const relocation: Describer = (c, ctx) => {
  const name = nameFor(c, ctx.targetNames) ?? "Relocation";

  if (c.opType === "add") {
    const p = (c.payload ?? {}) as Record<string, unknown>;
    const state = stateName(p.destinationState);
    const year = toNum(p.year);
    const detail =
      state && year != null ? `Moves to ${state} in ${year}`
      : state ? `Moves to ${state}`
      : year != null ? `State relocation effective ${year}`
      : "A state relocation is added to the plan.";
    return addRow("Plan & Assumptions", name, [detail]);
  }

  if (c.opType === "remove") {
    return removeRow("Plan & Assumptions", name, ["This relocation is removed."]);
  }

  // edit → reuse the generic field-diff skeleton, but surface destination-state
  // names (not raw USPS codes) in the change column.
  const payload = (c.payload ?? {}) as Record<string, { from: unknown; to: unknown }>;
  const mapped = Object.fromEntries(
    Object.entries(payload).map(([f, v]) =>
      f === "destinationState"
        ? [f, { from: stateName(v?.from) ?? v?.from, to: stateName(v?.to) ?? v?.to }]
        : [f, v],
    ),
  );
  return editRow({ ...c, payload: mapped }, { ...SPEC.relocation }, name);
};

/** A saved Solver stressor: the name stored at save time as the title, one
 *  plain-words line beneath. A payload that fails the schema still gets a
 *  title — never raw fractions or field names. */
const stressTest: Describer = (c, ctx) => {
  const parsed = stressTestSchema.safeParse(c.payload);
  const name = nameFor(c, ctx.targetNames) ?? (parsed.success ? parsed.data.name : "Stress test");
  if (c.opType === "remove") return removeRow("Plan & Assumptions", name, [SPEC.stress_test.whyRemove]);
  return addRow("Plan & Assumptions", name, parsed.success ? [stressTestDetail(parsed.data)] : []);
};

DESCRIBERS.client = client;
DESCRIBERS.plan_settings = planSettings;
DESCRIBERS.family_member = familyMember;
DESCRIBERS.withdrawal_strategy = withdrawalStrategy;
DESCRIBERS.relocation = relocation;
DESCRIBERS.stress_test = stressTest;
