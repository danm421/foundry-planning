import { firesAtDeath, selectResiduaryTier } from "@/engine/death-event";
import type {
  Account,
  ClientData,
  Will,
  WillBequest,
  WillBequestRecipient,
  WillResiduaryRecipient,
} from "@/engine/types";
import { formatNameList } from "@/lib/intake/estate";
import { spouseOf, type FundingItem } from "./guided-trust";
import { isTrustHeld } from "./revocable-trust-rows";
import { accountName, roleFirstName } from "./trust-labels";
import type { SolverMutation } from "./types";

// The guided trust wizard's "at death" funding: each bequest answer becomes a
// clause in the grantor's will naming the trust, and a one-line note says when
// that clause competes with what the will already does. The engine pays every
// will gift top to bottom in list order (`sortOrder`), each from what is left
// at its turn, and the new clause is appended at the bottom — so the note only
// says what the gifts above it have already taken.

type BequestItem = Extract<FundingItem, { kind: "bequest" }>;
type Grantor = "client" | "spouse";
type Condition = WillBequest["condition"];
type Recipient = WillBequestRecipient | WillResiduaryRecipient;

/** The wills an item writes and the condition each clause carries. A
 *  second-death bequest goes in BOTH wills, firing only once the other spouse
 *  has died — whichever of them dies last, their will carries it. */
function targets(item: BequestItem): { grantor: Grantor; condition: Condition }[] {
  if (item.from === "second_death") {
    return [
      { grantor: "client", condition: "if_spouse_predeceased" },
      { grantor: "spouse", condition: "if_spouse_predeceased" },
    ];
  }
  return [{ grantor: item.from, condition: item.condition }];
}

/** Categories a will never passes: retirement and life insurance go by
 *  beneficiary designation (as the base bequest editor hides them), and a
 *  specific bequest ignores a business interest. */
const NOT_BY_WILL = new Set<Account["category"]>(["retirement", "life_insurance", "business"]);

/**
 * The accounts an "At death → One account" bequest can name: owned (alone or
 * jointly) by the will's maker — either spouse for "whoever dies second" — and
 * never trust-held, gifted to a trust, or already funding this trust
 * (`excluded`). Anything else the engine would pay out some other way first,
 * so the clause would silently pass nothing.
 */
export function bequestableAccounts(
  tree: ClientData,
  from: BequestItem["from"],
  excluded: ReadonlySet<string>,
): Account[] {
  const roles: Grantor[] = from === "second_death" ? ["client", "spouse"] : [from];
  const makers = new Set(
    (tree.familyMembers ?? []).flatMap((f) => (roles.includes(f.role as Grantor) ? [f.id] : [])),
  );
  const giftedToTrust = new Set(
    (tree.giftEvents ?? []).flatMap((e) => (e.kind === "asset" && e.recipientEntityId ? [e.accountId] : [])),
  );
  return tree.accounts.filter(
    (a) =>
      !NOT_BY_WILL.has(a.category) &&
      !excluded.has(a.id) &&
      !giftedToTrust.has(a.id) &&
      !isTrustHeld(a) &&
      a.owners.some((o) => o.kind === "family_member" && makers.has(o.familyMemberId) && o.percent > 0),
  );
}

/**
 * One `will-upsert` per will the items touch. The Solver's working set keeps
 * one mutation per key, so a second upsert for the same will would REPLACE the
 * first — every item aimed at a will is folded into a single mutation. Each
 * upsert starts from the will as it is in `tree`: its other bequests stay, and
 * its `residuaryRecipients` key stays exactly as present or absent.
 */
export function buildBequestMutations(
  items: BequestItem[],
  trust: { id: string; name: string },
  tree: ClientData,
  newId: () => string = () => crypto.randomUUID(),
): SolverMutation[] {
  const wills = new Map<Grantor, Will>();
  for (const item of items) {
    const { what } = item;
    const specific = what.mode === "specific" ? what : null;
    for (const { grantor, condition } of targets(item)) {
      const will =
        wills.get(grantor) ??
        tree.wills?.find((w) => w.grantor === grantor) ??
        { id: newId(), grantor, bequests: [] };
      const bequest: WillBequest = {
        id: newId(),
        name: specific ? accountName(specific.accountId, tree, "Asset bequest") : "Estate (what's left at this point)",
        kind: "asset",
        assetMode: what.mode,
        accountId: specific?.accountId ?? null,
        entityId: null,
        liabilityId: null,
        // "Everything" carries no editable %: 100 means all of what's left at
        // this clause's turn in the list.
        percentage: specific?.percentage ?? 100,
        condition,
        sortOrder: Math.max(-1, ...will.bequests.map((b) => b.sortOrder)) + 1,
        recipients: [{ recipientKind: "entity", recipientId: trust.id, percentage: 100, sortOrder: 0 }],
      };
      wills.set(grantor, { ...will, bequests: [...will.bequests, bequest] });
    }
  }
  return [...wills.values()].map((w) => ({ kind: "will-upsert", id: w.id, value: w }));
}

function recipientName(r: Recipient, grantor: Grantor, tree: ClientData): string {
  switch (r.recipientKind) {
    case "family_member":
      return tree.familyMembers?.find((f) => f.id === r.recipientId)?.firstName ?? "an heir";
    case "external_beneficiary":
      return tree.externalBeneficiaries?.find((e) => e.id === r.recipientId)?.name ?? "an heir";
    case "entity":
      return tree.entities?.find((e) => e.id === r.recipientId)?.name ?? "an heir";
    case "spouse":
      // The engine pays a "spouse" recipient to whoever survives the grantor.
      return roleFirstName(spouseOf(grantor), tree);
    case "other_heirs":
      return "other heirs";
  }
}

/** The deaths (1 = first, 2 = final) a clause with `condition` fires at. A
 *  single client has only a final death. (firesAtDeath reads only `condition`.) */
function firingDeaths(condition: Condition, married: boolean): (1 | 2)[] {
  const deaths: (1 | 2)[] = married ? [1, 2] : [2];
  return deaths.filter((d) => firesAtDeath({ condition } as WillBequest, d));
}

/** recipientHasLapsed: a "spouse" recipient takes nothing when no spouse
 *  survives the grantor — always so at the final death (survivorFmId null). */
function lapses(r: Recipient, d: 1 | 2, grantor: Grantor, tree: ClientData): boolean {
  if (r.recipientKind !== "spouse") return false;
  return d === 2 || !tree.familyMembers?.some((f) => f.role === spouseOf(grantor));
}

/** The recipients who actually take a share at death `d`. */
function takers<R extends Recipient>(rs: R[], d: 1 | 2, grantor: Grantor, tree: ClientData): R[] {
  return rs.filter((r) => r.percentage > 0 && !lapses(r, d, grantor, tree));
}

/**
 * True when the residuary still receives something at death `d` even with a
 * 100% estate clause at the bottom of the list: a business interest the will
 * doesn't name (business succession goes specific → residuary and never
 * consults the estate-percentage clauses). Everything else is swept.
 */
function residuaryStillReceives(will: Will, d: 1 | 2, tree: ClientData): boolean {
  const named = will.bequests.filter((b) => b.assetMode === "specific" && firesAtDeath(b, d));
  const grantorFmId = tree.familyMembers?.find((f) => f.role === will.grantor)?.id;
  return tree.accounts.some(
    (a) =>
      a.category === "business" &&
      a.parentAccountId == null &&
      a.owners.some((o) => o.kind === "family_member" && o.familyMemberId === grantorFmId) &&
      !named.some((b) => b.entityId === a.id),
  );
}

/** Cash and taxable accounts are the only ones a dollar gift is paid from. */
const isCashLike = (a: Account | undefined) => a?.category === "cash" || a?.category === "taxable";

/** True when a gift already on the will could take from `accountId` ahead of a
 *  new clause: a specific gift of that account, an estate-percentage gift, or
 *  a dollar gift drawn estate-wide (cash/taxable only) or from that account.
 *  A named-account dollar gift that falls back to the estate counts too when
 *  the account is cash-like, since it may draw there. */
function drawsOn(b: WillBequest, accountId: string, tree: ClientData): boolean {
  if (b.kind === "dollar") {
    const cashLike = isCashLike(tree.accounts.find((a) => a.id === accountId));
    if (b.dollarSource === "account") return b.accountId === accountId || (!!b.fallbackToEstate && cashLike);
    return b.dollarSource === "estate" && cashLike;
  }
  if (b.kind !== "asset") return false;
  return b.assetMode === "all_assets" || (b.assetMode === "specific" && b.accountId === accountId);
}

function noteFor(will: Will, what: BequestItem["what"], condition: Condition, tree: ClientData): string | null {
  const { grantor } = will;
  const married = tree.client.spouseDob != null;
  const deaths = firingDeaths(condition, married);
  const first = roleFirstName(grantor, tree);
  const firingAt = (d: 1 | 2) => will.bequests.filter((b) => firesAtDeath(b, d));

  if (what.mode === "specific") {
    const { accountId } = what;
    if (!deaths.some((d) => firingAt(d).some((b) => drawsOn(b, accountId, tree)))) return null;
    return `Gifts listed above this one in ${first}'s will are paid first, so this trust gets ${what.percentage}% of what's left of ${accountName(accountId, tree)}.`;
  }

  // Everything: this clause sits last and takes all that's left, so anything
  // the residuary step would have taken goes to the trust instead — from the
  // tier that governs each death.
  const hasAbove = deaths.some((d) => firingAt(d).some((b) => b.kind !== "liability"));
  const heirs = deaths
    .filter((d) => !residuaryStillReceives(will, d, tree))
    .flatMap((d) => {
      const tier = selectResiduaryTier(d, married);
      const tierHeirs = (will.residuaryRecipients ?? []).filter((r) => (r.tier ?? "primary") === tier);
      return takers(tierHeirs, d, grantor, tree);
    });
  const nothing =
    heirs.length > 0
      ? `${first}'s residuary heirs (${formatNameList([...new Set(heirs.map((r) => recipientName(r, grantor, tree)))])}) get nothing at that death.`
      : null;
  if (hasAbove) {
    const above = `Gifts listed above this one in ${first}'s will are paid first; this trust gets everything left after them`;
    return nothing ? `${above}, so ${nothing}` : `${above}.`;
  }
  return nothing ? `This trust gets everything left, so ${nothing}` : null;
}

/** A one-line warning when the bequest competes with what the grantor's will
 *  already says, or null. A second-death bequest checks both wills. */
export function willConflictNote(item: BequestItem, tree: ClientData): string | null {
  for (const { grantor, condition } of targets(item)) {
    const will = tree.wills?.find((w) => w.grantor === grantor);
    const note = will ? noteFor(will, item.what, condition, tree) : null;
    if (note) return note;
  }
  return null;
}
