import type { AccountOwner } from "@/engine/ownership";
import { resolveOwnersFromHint, type OwnerMatchFamilyMember } from "@/lib/imports/owner-match";
import { isRetirementSubType } from "@/lib/accounts/retirement-subtypes";

/**
 * The Owner cell's option list, and the translation between a picked option and
 * the `owners[]` the commit step actually writes.
 *
 * Pure, and deliberately NOT a second ownership model: the values produced here
 * are ordinary `AccountOwner` rows, the same shape `OwnershipEditor` produces
 * and `validateOwnersShape` accepts. What this adds is a one-click vocabulary
 * for the shapes a statement actually shows — one person, one trust, or the two
 * spouses jointly — instead of the coarse `client | spouse | joint` enum, which
 * cannot name a child, a trust, or anybody else on the plan.
 *
 * External beneficiaries are deliberately absent. `validateOwnersShape`
 * (`src/lib/ownership.ts`) accepts `family_member` and `entity` only, and the
 * import commit path writes exactly those two columns — offering a third would
 * be a control whose pick is dropped on the way to the database.
 */

/** Matches `ownership-editor.tsx`'s tolerance, and `validateOwnersShape`'s. */
const EPSILON = 0.0001;

/** The option value for "the two spouses, 50/50". */
export const JOINT_OPTION_VALUE = "joint";

export interface OwnerEntityOption {
  id: string;
  name: string;
}

export interface OwnerOption {
  value: string;
  label: string;
  /** `<optgroup>` heading; options are emitted already grouped, in order. */
  group: string;
}

export const HOUSEHOLD_GROUP = "Household";
export const ENTITY_GROUP = "Trusts & entities";

/** "Jane Whitfield", or just "Jane" when the roster has no surname. */
export function familyMemberName(fm: Pick<OwnerMatchFamilyMember, "firstName" | "lastName">): string {
  return [fm.firstName, fm.lastName].filter((p) => typeof p === "string" && p.trim()).join(" ").trim();
}

function clientAndSpouse(family: OwnerMatchFamilyMember[]) {
  return {
    client: family.find((f) => f.role === "client"),
    spouse: family.find((f) => f.role === "spouse"),
  };
}

/**
 * Build the dropdown's options from the plan's own roster.
 *
 * `subType` decides whether a joint option is offered at all: the
 * `account_owners_retirement_check` trigger holds an IRA/401(k)/403(b) to one
 * owner at 100%, and `writeImportedOwners` silently collapses a multi-owner
 * retirement set back to coarse synthesis rather than failing. Offering Joint
 * there would be a pick the commit quietly discards.
 */
export function buildOwnerOptions(
  family: OwnerMatchFamilyMember[],
  entities: OwnerEntityOption[],
  opts: { subType?: string | null },
): OwnerOption[] {
  const options: OwnerOption[] = [];
  const { client, spouse } = clientAndSpouse(family);

  for (const fm of family) {
    const name = familyMemberName(fm);
    if (!name) continue;
    options.push({
      value: `fm:${fm.id}`,
      label: name,
      group: HOUSEHOLD_GROUP,
    });
  }

  if (client && spouse && !isRetirementSubType(opts.subType)) {
    options.push({
      value: JOINT_OPTION_VALUE,
      label: `${client.firstName} & ${spouse.firstName} (joint)`,
      group: HOUSEHOLD_GROUP,
    });
  }

  for (const e of entities) {
    if (!e.name?.trim()) continue;
    options.push({ value: `ent:${e.id}`, label: e.name, group: ENTITY_GROUP });
  }

  return options;
}

/** Group `buildOwnerOptions`' flat list into `<optgroup>`s, order preserved. */
export function groupOwnerOptions(options: OwnerOption[]): Array<{ group: string; options: OwnerOption[] }> {
  const groups: Array<{ group: string; options: OwnerOption[] }> = [];
  for (const option of options) {
    const last = groups[groups.length - 1];
    if (last && last.group === option.group) last.options.push(option);
    else groups.push({ group: option.group, options: [option] });
  }
  return groups;
}

function isWhole(percent: number): boolean {
  return Math.abs(percent - 1) < EPSILON;
}

function isHalf(percent: number): boolean {
  return Math.abs(percent - 0.5) < EPSILON;
}

/**
 * Which option a row's current `owners[]` corresponds to, or `null` when it is a
 * split this one-select cell cannot name (three owners, an uneven pair, an
 * external beneficiary inherited from elsewhere).
 *
 * `null` is not an error — the read cell still shows every resolved name. It
 * only means the select opens with nothing pre-chosen, which is honest: picking
 * an option would REPLACE that split, and pre-selecting one of its members would
 * imply the split was already that.
 */
export function ownersToOptionValue(
  owners: AccountOwner[] | undefined,
  family: OwnerMatchFamilyMember[],
): string | null {
  if (!owners || owners.length === 0) return null;

  if (owners.length === 1) {
    const [o] = owners;
    if (!isWhole(o.percent)) return null;
    if (o.kind === "family_member") return `fm:${o.familyMemberId}`;
    if (o.kind === "entity") return `ent:${o.entityId}`;
    return null;
  }

  if (owners.length === 2) {
    const { client, spouse } = clientAndSpouse(family);
    if (!client || !spouse) return null;
    const ids = owners.map((o) =>
      o.kind === "family_member" && isHalf(o.percent) ? o.familyMemberId : null,
    );
    if (ids.includes(client.id) && ids.includes(spouse.id) && !ids.includes(null)) {
      return JOINT_OPTION_VALUE;
    }
  }

  return null;
}

/**
 * The `owners[]` a picked option writes. Returns `null` for an option the roster
 * can no longer satisfy (a joint pick on a household that lost its co-client
 * between render and click), so the caller writes nothing rather than a set that
 * fails `validateOwnersShape` and falls back to the coarse enum unannounced.
 */
export function optionValueToOwners(
  value: string,
  family: OwnerMatchFamilyMember[],
): AccountOwner[] | null {
  if (value === JOINT_OPTION_VALUE) {
    const { client, spouse } = clientAndSpouse(family);
    if (!client || !spouse) return null;
    return [
      { kind: "family_member", familyMemberId: client.id, percent: 0.5 },
      { kind: "family_member", familyMemberId: spouse.id, percent: 0.5 },
    ];
  }
  if (value.startsWith("fm:")) {
    const id = value.slice(3);
    if (!family.some((f) => f.id === id)) return null;
    return [{ kind: "family_member", familyMemberId: id, percent: 1 }];
  }
  if (value.startsWith("ent:")) {
    const id = value.slice(4);
    return [{ kind: "entity", entityId: id, percent: 1 }];
  }
  return null;
}

/**
 * The display name(s) for a row's resolved owners — what the read cell prints
 * instead of "Client" or "Joint".
 *
 * An owner whose id is not on the roster is SKIPPED rather than rendered as a
 * raw UUID: it means the family member or entity was deleted since the row was
 * annotated, and a bare id tells the advisor less than nothing. If that empties
 * the list the caller falls back to the statement's printed registration name,
 * which is the same thing it shows for a row that was never resolved at all.
 */
export function ownerDisplayNames(
  owners: AccountOwner[] | undefined,
  family: OwnerMatchFamilyMember[],
  entities: OwnerEntityOption[],
): string[] {
  if (!owners || owners.length === 0) return [];
  const names: string[] = [];
  for (const o of owners) {
    if (o.kind === "family_member") {
      const fm = family.find((f) => f.id === o.familyMemberId);
      const name = fm ? familyMemberName(fm) : "";
      if (name) names.push(name);
    } else if (o.kind === "entity") {
      const e = entities.find((x) => x.id === o.entityId);
      if (e?.name) names.push(e.name);
    }
  }
  return names;
}

/**
 * What the Owner cell should PRINT for a row, and whether that is a guess.
 *
 * One rule in one place, because the two halves are easy to get out of step:
 *
 * - `owners[]` present → those names, `assumed: false`. It is a recorded fact,
 *   put there by the advisor picking or by the registration line matching
 *   somebody on the roster, and it is exactly what `writeImportedOwners`
 *   persists.
 * - otherwise → resolve the printed registration line and the coarse enum
 *   through the roster, and report those names as `assumed: true`. This is not
 *   inventing anything: with no `owners[]`, `commit/accounts.ts` runs the SAME
 *   enum through `synthesizeAccountOwners` and writes those very people. Naming
 *   them is a more accurate account of what will commit than the word "Client",
 *   and the chip keeps it honest about nobody having confirmed it.
 *
 * Empty `names` means the roster cannot answer at all — no family members
 * loaded, or a hint naming nobody on the plan — and the cell falls back to the
 * printed registration string.
 */
export function resolveOwnerDisplay(
  row: { owners?: AccountOwner[]; ownerNameHint?: string; owner?: "client" | "spouse" | "joint" },
  family: OwnerMatchFamilyMember[],
  entities: OwnerEntityOption[],
): { names: string[]; assumed: boolean } {
  const recorded = ownerDisplayNames(row.owners, family, entities);
  if (recorded.length > 0) return { names: recorded, assumed: false };

  if (family.length === 0) return { names: [], assumed: true };
  const { owners } = resolveOwnersFromHint(row.ownerNameHint, row.owner, family);
  return { names: ownerDisplayNames(owners, family, entities), assumed: true };
}
