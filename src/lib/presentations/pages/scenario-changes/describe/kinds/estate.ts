import { addRow, removeRow, editRow } from "../generic";
import { nameFor } from "../format";
import { money, label, pct } from "../labels";
import { SPEC } from "../specs";
import { DESCRIBERS, simpleDescriber, type Describer } from "../registry";
import type { ResolveContext, RecipientKind } from "../resolve";

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

interface Recipient { recipientKind: RecipientKind; recipientId: string | null; percentage: number }
interface Bequest {
  id: string; kind?: string; assetMode?: string | null; accountId?: string | null;
  entityId?: string | null; liabilityId?: string | null; percentage?: number;
  condition?: string; recipients?: Recipient[];
}

function recipients(b: Bequest, ctx: ResolveContext): string {
  const rs = b.recipients ?? [];
  if (!rs.length) return "—";
  return rs.map((r) => ctx.recipientName(r.recipientKind, r.recipientId)).join(" & ");
}
function whatGoes(b: Bequest, ctx: ResolveContext): string {
  if (b.kind === "liability") return ctx.accountName(b.liabilityId ?? null); // liabilities not in accountsById; falls back to "an account" gracefully
  if (b.assetMode === "specific" && b.accountId) return ctx.accountName(b.accountId);
  if (b.assetMode === "specific" && b.entityId) return ctx.entityName(b.entityId);
  if (b.assetMode === "all_assets") return "All remaining assets";
  if (b.percentage != null) return `${pct(b.percentage)} of estate`;
  return "Bequest";
}
function bequestLine(b: Bequest, ctx: ResolveContext, prefix = ""): string {
  const cond = b.condition && b.condition !== "always" ? ` (${label("bequestCondition", b.condition)})` : "";
  return `${prefix}${whatGoes(b, ctx)} → ${recipients(b, ctx)}${cond}`;
}

const will: Describer = (c, ctx) => {
  const name = nameFor(c, ctx.targetNames) ?? "Will";
  if (c.opType === "remove") return removeRow("Estate", name, ["No longer in this plan"]);

  const payload = (c.payload ?? {}) as Record<string, unknown>;

  // ADD → payload is the full will; enumerate its bequests.
  if (c.opType === "add") {
    const bs = Array.isArray(payload.bequests) ? (payload.bequests as Bequest[]) : [];
    const lines = bs.length ? bs.map((b) => bequestLine(b, ctx.resolve)) : ["New will added"];
    return addRow("Estate", name, lines);
  }

  // EDIT → diff the bequests array by id (the [object Object] root cause).
  const diff = payload.bequests as { from?: Bequest[]; to?: Bequest[] } | undefined;
  if (!diff) {
    return { area: "Estate", what: name, op: "edit", before: "—", after: "Updated",
      detail: Object.keys(payload).map((f) => `Updated ${f}`) };
  }
  const from = diff.from ?? [], to = diff.to ?? [];
  const fromById = new Map(from.map((b) => [b.id, b]));
  const toById = new Map(to.map((b) => [b.id, b]));
  const lines: string[] = [];
  for (const b of to) if (!fromById.has(b.id)) lines.push(bequestLine(b, ctx.resolve, "Added: "));
  for (const b of from) if (!toById.has(b.id)) lines.push(bequestLine(b, ctx.resolve, "Removed: "));
  for (const b of to) {
    const prev = fromById.get(b.id);
    if (prev && JSON.stringify(prev) !== JSON.stringify(b)) lines.push(bequestLine(b, ctx.resolve, "Changed: "));
  }
  if (!lines.length) lines.push("Bequests reordered");
  return { area: "Estate", what: name, op: "edit", before: "—", after: "Updated", detail: lines };
};

DESCRIBERS.will = will;
// will_bequest / will_bequest_recipient never arrive as discrete changes (nested-only),
// but register safe fallbacks in case the writer ever emits them:
DESCRIBERS.will_bequest = simpleDescriber({ area: "Estate", noun: "bequest", whatMode: "name", segments: [] });
DESCRIBERS.will_bequest_recipient = simpleDescriber({ area: "Estate", noun: "bequest recipient", whatMode: "name", segments: [] });
