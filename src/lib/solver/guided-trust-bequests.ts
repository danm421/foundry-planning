import { firesAtDeath, selectResiduaryTier } from "@/engine/death-event";
import type {
  ClientData,
  Will,
  WillBequest,
  WillBequestRecipient,
  WillResiduaryRecipient,
} from "@/engine/types";
import { formatNameList } from "@/lib/intake/estate";
import { spouseOf, type FundingItem } from "./guided-trust";
import type { SolverMutation } from "./types";

// The guided trust wizard's "at death" funding: each bequest answer becomes a
// clause in the grantor's will naming the trust, and a one-line note says when
// that clause competes with what the will already does. The note describes the
// death-event engine's will steps (death-event/shared.ts) and nothing more.

type BequestItem = Extract<FundingItem, { kind: "bequest" }>;
type Grantor = "client" | "spouse";
type Condition = WillBequest["condition"];
type Recipient = WillBequestRecipient | WillResiduaryRecipient;

/** Engine percentages are 0-100; over-allocation is a strict "> 100". */
const PCT_EPS = 1e-7;

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

function accountName(accountId: string, tree: ClientData): string {
  // Same fallback the will editor's bequest dialog uses.
  return tree.accounts.find((a) => a.id === accountId)?.name?.trim() || "Asset bequest";
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
        name: specific ? accountName(specific.accountId, tree) : "Remaining Estate Value",
        kind: "asset",
        assetMode: what.mode,
        accountId: specific?.accountId ?? null,
        entityId: null,
        liabilityId: null,
        // "Everything" carries no editable %: the engine weighs all_assets
        // clauses against each other, so 100 is just this clause's weight.
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

function firstName(role: Grantor, tree: ClientData): string {
  return role === "client" ? tree.client.firstName : (tree.client.spouseName ?? "Spouse");
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
      return firstName(spouseOf(grantor), tree);
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

const totalPct = (bs: { percentage: number }[]) => bs.reduce((s, b) => s + b.percentage, 0);

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

/** The percent of a clause its takers claim at `d` (100 = all of it). */
const claimedPct = (b: WillBequest, d: 1 | 2, grantor: Grantor, tree: ClientData) =>
  totalPct(takers(b.recipients, d, grantor, tree));

/**
 * True when the residuary still receives something at death `d` even with an
 * all_assets clause in force: an account that firing specific clauses claim
 * only part of (applyWillAllAssetsResidual skips any account a specific clause
 * claimed anything of, so the rest — a lapsed recipient's share included —
 * falls to the residuary), or a business interest the will doesn't name
 * (business succession goes specific → residuary and never consults
 * all_assets clauses).
 */
function residuaryStillReceives(will: Will, d: 1 | 2, tree: ClientData): boolean {
  const specifics = will.bequests.filter((b) => b.assetMode === "specific" && firesAtDeath(b, d));
  const byAccount = new Map<string, WillBequest[]>();
  for (const b of specifics) {
    if (b.accountId) byAccount.set(b.accountId, [...(byAccount.get(b.accountId) ?? []), b]);
  }
  for (const clauses of byAccount.values()) {
    // applyWillSpecificBequests: pro-rate past 100%, then pay only the takers.
    const scale = Math.min(1, 100 / totalPct(clauses));
    const claimed = clauses.reduce(
      (s, b) => s + (b.percentage / 100) * scale * (claimedPct(b, d, will.grantor, tree) / 100),
      0,
    );
    if (claimed > PCT_EPS && claimed < 1 - PCT_EPS) return true;
  }
  const grantorFmId = tree.familyMembers?.find((f) => f.role === will.grantor)?.id;
  return tree.accounts.some(
    (a) =>
      a.category === "business" &&
      a.parentAccountId == null &&
      a.owners.some((o) => o.kind === "family_member" && o.familyMemberId === grantorFmId) &&
      !specifics.some((b) => b.entityId === a.id),
  );
}

function noteFor(will: Will, what: BequestItem["what"], condition: Condition, tree: ClientData): string | null {
  const { grantor } = will;
  const married = tree.client.spouseDob != null;
  const deaths = firingDeaths(condition, married);
  const first = firstName(grantor, tree);
  const nameList = (rs: Recipient[]) =>
    formatNameList([...new Set(rs.map((r) => recipientName(r, grantor, tree)))]);
  // Only recipients who actually take something are ever named.
  const names = (rs: Recipient[], d: 1 | 2) => nameList(takers(rs, d, grantor, tree));
  const firingAt = (d: 1 | 2) => will.bequests.filter((b) => firesAtDeath(b, d));

  if (what.mode === "specific") {
    // applyWillSpecificBequests pro-rates every firing clause on the account
    // once their percentages pass 100 — lapsed recipients' clauses included.
    // Silent when the other clause pays no one at that death.
    for (const d of deaths) {
      const same = firingAt(d).filter((b) => b.assetMode === "specific" && b.accountId === what.accountId);
      const others = names(same.flatMap((b) => b.recipients), d);
      if (others && what.percentage + totalPct(same) > 100 + PCT_EPS) {
        return `With the existing bequest of ${accountName(what.accountId, tree)} to ${others}, this is over 100%, so both are scaled down.`;
      }
    }
    return null;
  }

  // applyWillAllAssetsResidual splits the residual across firing all_assets
  // clauses by their percentage weights; this clause weighs 100. The weight of
  // a clause whose recipient has lapsed still counts against this trust, but
  // its share goes on down the chain rather than to that recipient — so name
  // recipients only when every competing clause pays its takers in full.
  for (const d of deaths) {
    const others = firingAt(d).filter((b) => b.assetMode === "all_assets");
    if (others.length === 0) continue;
    // A 0% clause can't be split (splitAccount throws on a 0 share; the will
    // schema rejects it), so there is no outcome to describe.
    if (others.some((b) => b.percentage <= 0)) return null;
    const share = Math.round((100 * 100) / (100 + totalPct(others)));
    const paidInFull = others.every((b) => Math.abs(claimedPct(b, d, grantor, tree) - 100) < PCT_EPS);
    return paidInFull
      ? `${first}'s will already leaves everything to ${names(others.flatMap((b) => b.recipients), d)} at that death; this trust shares it — ${share}% to this trust.`
      : `${first}'s will has another clause leaving everything at that death, so this trust gets only ${share}%.`;
  }

  // No other all_assets clause fires, so this one sweeps what the residuary
  // step would have taken — from the tier that governs each death.
  const heirs = deaths
    .filter((d) => !residuaryStillReceives(will, d, tree))
    .flatMap((d) => {
      const tier = selectResiduaryTier(d, married);
      const tierHeirs = (will.residuaryRecipients ?? []).filter((r) => (r.tier ?? "primary") === tier);
      return takers(tierHeirs, d, grantor, tree);
    });
  if (heirs.length === 0) return null;
  return `This takes everything a specific bequest doesn't, so ${first}'s residuary heirs (${nameList(heirs)}) get nothing at that death.`;
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
