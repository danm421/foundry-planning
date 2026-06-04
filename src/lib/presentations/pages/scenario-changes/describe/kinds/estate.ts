import { addRow, removeRow, editRow } from "../generic";
import { nameFor } from "../format";
import { money, label } from "../labels";
import { SPEC } from "../specs";
import { DESCRIBERS, simpleDescriber, type Describer } from "../registry";

const num = (v: unknown) => (typeof v === "string" ? Number(v) : (v as number));

const gift: Describer = (c, ctx) => {
  const name = nameFor(c, ctx.targetNames) ?? "Gift";
  if (c.opType === "remove") return removeRow("Estate", name, ["No longer in this plan"]);
  if (c.opType === "edit") return editRow(c, { ...SPEC.gift }, name);
  const p = (c.payload ?? {}) as Record<string, unknown>;
  const recip = p.recipientFamilyMemberId
    ? ctx.resolve.recipientName("family_member", p.recipientFamilyMemberId as string)
    : p.recipientExternalBeneficiaryId
    ? ctx.resolve.recipientName("external_beneficiary", p.recipientExternalBeneficiaryId as string)
    : p.recipientEntityId
    ? ctx.resolve.entityName(p.recipientEntityId as string)
    : "a recipient";
  return addRow("Estate", name, [`${money(p.amount)} in ${num(p.year)} → ${recip}`]);
};

DESCRIBERS.gift = gift;

DESCRIBERS.entity = simpleDescriber({
  area: "Estate", noun: "trust / entity", whatMode: "name",
  segments: [
    (p) => label("entityType", p.entityType),
    (p) => (p.value != null ? money(p.value) : null),
  ],
});

DESCRIBERS.external_beneficiary = simpleDescriber({
  area: "Estate", noun: "beneficiary", whatMode: "name",
  segments: [
    (p) => (typeof p.kind === "string" ? String(p.kind) : null),
  ],
});

DESCRIBERS.beneficiary_designation = simpleDescriber({
  area: "Estate", noun: "beneficiary designation", whatMode: "name",
  segments: [() => "Account beneficiary"],
});

DESCRIBERS.life_insurance_policy = simpleDescriber({
  area: "Estate", noun: "life insurance policy", whatMode: "name",
  segments: [],
});

DESCRIBERS.life_insurance_cash_value_schedule = simpleDescriber({
  area: "Estate", noun: "policy cash value", whatMode: "name",
  segments: [() => "Custom cash-value schedule"],
});
