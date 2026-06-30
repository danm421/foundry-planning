import { USPS_STATE_NAMES, isUSPSStateCode } from "@/lib/usps-states";
import { editRow, addRow, removeRow } from "../generic";
import { nameFor } from "../format";
import { toNum } from "../labels";
import { SPEC } from "../specs";
import { DESCRIBERS, simpleDescriber, type Describer } from "../registry";

const ASSUMPTION_LINE: Record<string, (to: unknown) => string> = {
  retirementAge: (to) => `Client retires at ${to}`,
  spouseRetirementAge: (to) => `Spouse retires at ${to}`,
  lifeExpectancy: (to) => `Plan to client age ${to}`,
  spouseLifeExpectancy: (to) => `Plan to spouse age ${to}`,
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

const planSettings: Describer = (c, ctx) =>
  editRow(c, { ...SPEC.plan_settings }, nameFor(c, ctx.targetNames) ?? "Plan assumption");

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

DESCRIBERS.client = client;
DESCRIBERS.plan_settings = planSettings;
DESCRIBERS.family_member = familyMember;
DESCRIBERS.withdrawal_strategy = withdrawalStrategy;
DESCRIBERS.relocation = relocation;
