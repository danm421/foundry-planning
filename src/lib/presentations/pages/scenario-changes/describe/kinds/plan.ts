import { editRow, addRow, removeRow } from "../generic";
import { nameFor } from "../format";
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

const withdrawalStrategy: Describer = (c, _ctx) => {
  if (c.opType === "add") return addRow("Plan & Assumptions", "Withdrawal strategy", ["Sets the account draw-down order"]);
  if (c.opType === "remove") return removeRow("Plan & Assumptions", "Withdrawal strategy", ["Reverts to default draw-down order"]);
  return editRow(c, { ...SPEC.withdrawal_strategy }, "Withdrawal strategy");
};

DESCRIBERS.client = client;
DESCRIBERS.plan_settings = planSettings;
DESCRIBERS.family_member = familyMember;
DESCRIBERS.withdrawal_strategy = withdrawalStrategy;
