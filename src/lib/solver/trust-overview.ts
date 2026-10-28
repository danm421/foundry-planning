import type { ClientData, EntitySummary, Will, WillBequest } from "@/engine/types";
import type { EstateFlowGift } from "@/lib/estate/estate-flow-gifts";
import { formatCurrency } from "@/lib/cell-drill/format";
import { fundingItemLabel } from "./guided-trust-batch";
import { bequestWhen, pct, roleFirstName } from "./trust-labels";

// One-line descriptions for the Estate planning dialog's overview list: who
// gets what's left of a trust, and what funds it. Display only — read off the
// working tree and the dialog's planned-gift list.

type Grantor = Will["grantor"];

function bequestThing(b: WillBequest, share: number, tree: ClientData): string {
  if (b.assetMode === "all_assets") return share >= 100 ? "everything" : `${pct(share)} of everything`;
  const name =
    (b.accountId && tree.accounts.find((a) => a.id === b.accountId)?.name?.trim()) ||
    (b.entityId && tree.entities?.find((e) => e.id === b.entityId)?.name?.trim()) ||
    "an account";
  return `${pct((b.percentage * share) / 100)} of ${name}`;
}

function dollarThing(b: WillBequest, amount: number, tree: ClientData): string {
  const from =
    b.dollarSource === "account" && b.accountId
      ? tree.accounts.find((a) => a.id === b.accountId)?.name?.trim() || "an account"
      : "cash & brokerage";
  return `${formatCurrency(amount)} from ${from}`;
}

/**
 * Every will clause that sends something to the trust. A pair of matching
 * "if the other has died" clauses in both wills is how the wizard writes a
 * second-death bequest, so it reads back as one "whoever dies second" line.
 */
function bequestLines(entity: EntitySummary, tree: ClientData): string[] {
  const clauses: { grantor: Grantor; condition: WillBequest["condition"]; thing: string }[] = [];
  const residues: string[] = [];
  for (const will of tree.wills ?? []) {
    for (const b of will.bequests) {
      if (b.kind === "liability") continue;
      for (const r of b.recipients) {
        if (r.recipientKind !== "entity" || r.recipientId !== entity.id) continue;
        const thing = b.kind === "dollar" ? dollarThing(b, r.amount ?? 0, tree) : bequestThing(b, r.percentage, tree);
        clauses.push({ grantor: will.grantor, condition: b.condition, thing });
      }
    }
    for (const r of will.residuaryRecipients ?? []) {
      if (r.recipientKind !== "entity" || r.recipientId !== entity.id || (r.tier ?? "primary") !== "primary") continue;
      const share = r.percentage >= 100 ? "" : `${pct(r.percentage)} of `;
      residues.push(`Bequest · ${share}what's left · ${roleFirstName(will.grantor, tree)}'s will`);
    }
  }

  const lines: string[] = [];
  const paired = new Set<number>();
  clauses.forEach((c, i) => {
    if (paired.has(i)) return;
    const twin =
      c.condition === "if_spouse_predeceased"
        ? clauses.findIndex(
            (o, j) => j > i && !paired.has(j) && o.grantor !== c.grantor && o.condition === c.condition && o.thing === c.thing,
          )
        : -1;
    if (twin >= 0) {
      paired.add(twin);
      lines.push(`Bequest · ${c.thing} · whoever dies second`);
    } else {
      lines.push(`Bequest · ${c.thing} · ${bequestWhen(c.grantor, c.condition, tree)}`);
    }
  });
  return [...lines, ...residues];
}

/** Accounts the trust holds, other than its own default cash account. */
function heldLines(entity: EntitySummary, tree: ClientData): string[] {
  return tree.accounts.flatMap((a) => {
    if (a.isDefaultChecking) return [];
    const slice = a.owners.find((o) => o.kind === "entity" && o.entityId === entity.id);
    if (!slice) return [];
    const name = a.name?.trim() || "an account";
    return [slice.percent >= 1 ? `Holds ${name}` : `Holds ${pct(slice.percent * 100)} of ${name}`];
  });
}

/**
 * What funds the trust, in one line: the first source plus "+N more", or
 * "Not funded yet". Sources, in order: planned gifts into the trust (switched-off
 * ones skipped), will clauses naming it, and accounts it holds.
 */
export function trustFundingSummary(
  entity: EntitySummary,
  tree: ClientData,
  gifts: EstateFlowGift[],
): string {
  const lines = [
    ...gifts
      .filter((g) => g.enabled !== false && g.recipient.kind === "entity" && g.recipient.id === entity.id)
      .map((gift) => fundingItemLabel({ kind: "gift", gift }, tree)),
    ...bequestLines(entity, tree),
    ...heldLines(entity, tree),
  ];
  if (lines.length === 0) return "Not funded yet";
  return lines.length === 1 ? lines[0] : `${lines[0]} +${lines.length - 1} more`;
}

/** Who gets what's left, by first name — a CRT's charity included — or "—". */
export function remainderSummary(entity: EntitySummary, tree: ClientData): string {
  const names = (entity.remainderBeneficiaries ?? []).map((r) => {
    if (r.householdRole) return roleFirstName(r.householdRole, tree);
    if (r.familyMemberId) return tree.familyMembers?.find((f) => f.id === r.familyMemberId)?.firstName ?? "An heir";
    if (r.externalBeneficiaryId) {
      return tree.externalBeneficiaries?.find((x) => x.id === r.externalBeneficiaryId)?.name ?? "An heir";
    }
    if (r.entityIdRef) return tree.entities?.find((e) => e.id === r.entityIdRef)?.name ?? "A trust";
    return "Other heirs";
  });
  const charityId = entity.trustSubType === "crt" ? entity.splitInterest?.charityId : undefined;
  if (charityId) names.push(tree.externalBeneficiaries?.find((x) => x.id === charityId)?.name ?? "A charity");
  return names.length > 0 ? names.join(", ") : "—";
}
