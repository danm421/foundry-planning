import type {
  Account,
  ClientData,
  EntitySummary,
  TrustSplitInterestSnapshot,
  WillBequest,
} from "@/engine/types";
import type { EstateFlowGift } from "@/lib/estate/estate-flow-gifts";
import { householdAgePeople, type AgePerson } from "@/lib/year-or-age";

// The answers behind the Solver's step-by-step "add a trust" wizard, plus the
// pure rules around them: what each trust type presets, which steps it shows,
// what blocks "Next", and the people/labels the steps offer. No React, no DB.

export type GuidedTrustKind = "revocable" | "irrevocable" | "slat" | "ilit" | "idgt" | "crt" | "clt";
export type GuidedStep = "type" | "people" | "powers" | "funding" | "accounts" | "setup" | "review";

/** A person a trust benefits. Household principals are `household` refs,
 *  never family-member ids. */
export type PersonRef =
  | { kind: "household"; role: "client" | "spouse" }
  | { kind: "family_member"; id: string }
  | { kind: "external"; id: string }
  | { kind: "other_heirs" };

export interface PersonShare { person: PersonRef; percentage: number }
export interface PersonOption { ref: PersonRef; label: string; isGrantorSpouse: boolean }

export type FundingItem =
  | { kind: "gift"; gift: EstateFlowGift }
  | {
      kind: "bequest";
      from: "client" | "spouse" | "second_death";
      what: { mode: "all_assets" } | { mode: "specific"; accountId: string; percentage: number };
      condition: WillBequest["condition"];
    }
  | { kind: "retitle"; accountId: string }
  | { kind: "policy"; accountId: string };

export interface SplitInterestAnswers {
  snapshot: TrustSplitInterestSnapshot;
  fundingAccountIds: string[];
  newCharity: { id: string; name: string; charityType: "public" | "private" } | null;
}

export interface GuidedTrustAnswers {
  entityId: string;
  kind: GuidedTrustKind;
  grantor: "client" | "spouse";
  /** Who benefits while the trust runs (income beneficiaries). */
  lifetime: PersonShare[];
  /** Who gets what's left (remainder beneficiaries). */
  remainder: PersonShare[];
  isGrantor: boolean;
  grantorStatusEndYear: number | null;
  crummeyPowers: boolean;
  accessibleToClient: boolean;
  funding: FundingItem[];
  name: string;
  revocableAccountIds: string[];
  splitInterest: SplitInterestAnswers | null;
}

export interface GuidedTrustContext {
  tree: ClientData;
  isMarried: boolean;
  agePeople: AgePerson[];
  annualExclusionByYear: Record<number, number>;
  planStartYear: number;
}

/** Moved here from solver-trust-form.tsx (deleted in Task 15). */
export interface SolverTrustDraft {
  entity: EntitySummary;
  /** Accounts retitled into the trust, captured BEFORE retitle (for revert). */
  fundedOriginals: Account[];
  /** CLT only: id of the auto-emitted remainder-interest gift, cleared on removal. */
  remainderGiftId?: string;
}

const REMAINDER_HINT = "Pick who gets what's left — the 'to heirs' figures credit them.";

export function guidedTrustContext(
  tree: ClientData,
  annualExclusionByYear: Record<number, number>,
): GuidedTrustContext {
  const birthYear = (dob: string | undefined) => (dob ? Number(dob.slice(0, 4)) : undefined);
  return {
    tree,
    isMarried: tree.client.spouseDob != null,
    agePeople: householdAgePeople(
      {
        clientBirthYear: birthYear(tree.client.dateOfBirth),
        spouseBirthYear: birthYear(tree.client.spouseDob),
      },
      { client: tree.client.firstName, spouse: tree.client.spouseName ?? "Spouse" },
    ),
    annualExclusionByYear,
    planStartYear: tree.planSettings.planStartYear,
  };
}

export function initialAnswers(entityId: string): GuidedTrustAnswers {
  return {
    entityId,
    kind: "irrevocable",
    grantor: "client",
    lifetime: [],
    remainder: [],
    isGrantor: true,
    grantorStatusEndYear: null,
    crummeyPowers: true,
    accessibleToClient: false,
    funding: [],
    name: "",
    revocableAccountIds: [],
    splitInterest: null,
  };
}

export function spouseOf(role: "client" | "spouse"): "client" | "spouse" {
  return role === "client" ? "spouse" : "client";
}

/** Split 100% evenly in whole cents of a percent; the leftover cents go to the first. */
export function evenShares(people: PersonRef[]): PersonShare[] {
  const n = people.length;
  if (n === 0) return [];
  const base = Math.floor(10000 / n);
  const extra = 10000 - base * n;
  return people.map((person, i) => ({
    person,
    percentage: (base + (i === 0 ? extra : 0)) / 100,
  }));
}

function sameRef(a: PersonRef, b: PersonRef): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "household" && b.kind === "household") return a.role === b.role;
  if (a.kind === "family_member" && b.kind === "family_member") return a.id === b.id;
  if (a.kind === "external" && b.kind === "external") return a.id === b.id;
  return true;
}

/** Set the powers a trust type implies. Never clears people already picked;
 *  a SLAT only adds the grantor's spouse to the lifetime list. */
export function applyKindPreset(
  a: GuidedTrustAnswers,
  kind: GuidedTrustKind,
  _ctx: GuidedTrustContext,
): GuidedTrustAnswers {
  const next: GuidedTrustAnswers = { ...a, kind };
  switch (kind) {
    case "irrevocable":
      return { ...next, isGrantor: true, crummeyPowers: true, accessibleToClient: false };
    case "slat": {
      const spouse: PersonRef = { kind: "household", role: spouseOf(a.grantor) };
      const has = a.lifetime.some((s) => sameRef(s.person, spouse));
      return {
        ...next,
        isGrantor: true,
        crummeyPowers: true,
        accessibleToClient: true,
        lifetime: has ? a.lifetime : evenShares([...a.lifetime.map((s) => s.person), spouse]),
      };
    }
    case "ilit":
      return { ...next, crummeyPowers: true, isGrantor: false };
    case "idgt":
      return { ...next, isGrantor: true, crummeyPowers: false };
    case "crt":
      return { ...next, isGrantor: false };
    case "clt":
      return { ...next, isGrantor: true };
    case "revocable":
      return next;
  }
}

export function stepsFor(kind: GuidedTrustKind): GuidedStep[] {
  if (kind === "revocable") return ["type", "accounts", "review"];
  if (kind === "crt" || kind === "clt") return ["type", "setup", "review"];
  return ["type", "people", "powers", "funding", "review"];
}

function sharesOff(shares: PersonShare[]): boolean {
  return Math.abs(shares.reduce((s, x) => s + x.percentage, 0) - 100) > 0.01;
}

/** Why "Next" is disabled on `step`, or null when the step can proceed. */
export function stepBlocker(
  step: GuidedStep,
  a: GuidedTrustAnswers,
  ctx: GuidedTrustContext,
): string | null {
  switch (step) {
    case "people":
      if (a.lifetime.length === 0) return "Pick who can benefit while the trust runs.";
      if (a.remainder.length === 0) return REMAINDER_HINT;
      if (sharesOff(a.lifetime)) return "Shares under 'Benefits now' must add up to 100%.";
      if (sharesOff(a.remainder)) return "Shares under 'Gets what's left' must add up to 100%.";
      return null;
    case "accounts": {
      if (a.revocableAccountIds.length === 0) return "Pick at least one account to move in.";
      const name = a.name.trim();
      if (name && ctx.tree.accounts.some((x) => x.revocableTrustName?.trim() === name)) {
        return `A trust named ${name} already exists. Open it from the list to add accounts.`;
      }
      return null;
    }
    case "setup":
      if (!a.splitInterest) return "Finish the trust's payout and funding.";
      if (a.kind === "clt" && a.remainder.length === 0) return REMAINDER_HINT;
      return null;
    case "review":
      return a.name.trim() ? null : "Name the trust.";
    default:
      return null;
  }
}

/** People the people-step can offer. The grantor never appears; the grantor's
 *  spouse is offered first, for lifetime benefit only. */
export function trustPeopleOptions(
  tree: ClientData,
  grantor: "client" | "spouse",
  group: "lifetime" | "remainder",
): PersonOption[] {
  const options: PersonOption[] = [];
  if (group === "lifetime" && tree.client.spouseDob != null) {
    const role = spouseOf(grantor);
    const first = role === "spouse" ? tree.client.spouseName : tree.client.firstName;
    options.push({
      ref: { kind: "household", role },
      label: `${first ?? "Spouse"} (spouse)`,
      isGrantorSpouse: true,
    });
  }
  for (const fm of tree.familyMembers ?? []) {
    if (fm.role === "client" || fm.role === "spouse") continue;
    options.push({
      ref: { kind: "family_member", id: fm.id },
      label: `${fm.firstName} (${fm.relationship.replace(/_/g, " ")})`,
      isGrantorSpouse: false,
    });
  }
  for (const eb of tree.externalBeneficiaries ?? []) {
    if (eb.kind !== "individual") continue;
    options.push({ ref: { kind: "external", id: eb.id }, label: eb.name, isGrantorSpouse: false });
  }
  options.push({ ref: { kind: "other_heirs" }, label: "Other heirs", isGrantorSpouse: false });
  return options;
}

/** A SLAT is a grantor-funded irrevocable trust whose income goes to the grantor's spouse. */
export function isSlat(
  e: Pick<EntitySummary, "trustSubType" | "grantor" | "incomeBeneficiaries">,
): boolean {
  if (e.trustSubType !== "irrevocable" || !e.grantor) return false;
  const spouse = spouseOf(e.grantor);
  return (e.incomeBeneficiaries ?? []).some((b) => b.householdRole === spouse);
}

export function trustTypeLabel(e: EntitySummary): string {
  switch (e.trustSubType) {
    case "ilit":
    case "idgt":
    case "crt":
    case "clt":
      return e.trustSubType.toUpperCase();
    case "irrevocable":
      return isSlat(e) ? "SLAT" : "Irrevocable";
    default:
      return "Trust";
  }
}

/** The wizard kind for an existing trust ("Add funding"). */
export function guidedKindOf(e: EntitySummary): GuidedTrustKind {
  switch (e.trustSubType) {
    case "ilit":
    case "idgt":
    case "crt":
    case "clt":
      return e.trustSubType;
    default:
      return isSlat(e) ? "slat" : "irrevocable";
  }
}

export function defaultTrustName(a: GuidedTrustAnswers, tree: ClientData): string {
  const last = tree.client.lastName;
  if (a.kind === "revocable") return `${last} Family Revocable Trust`;
  if (a.kind === "crt") return "Charitable Remainder Trust";
  if (a.kind === "clt") return "Charitable Lead Trust";
  if (a.remainder.length === 1) {
    const p = a.remainder[0].person;
    if (p.kind === "household") {
      const first = p.role === "spouse" ? tree.client.spouseName : tree.client.firstName;
      if (first) return `${first} ${last} Irrevocable Trust`;
    } else if (p.kind === "family_member") {
      const fm = tree.familyMembers?.find((f) => f.id === p.id);
      if (fm) return `${fm.firstName} ${fm.lastName ?? last} Irrevocable Trust`;
    } else if (p.kind === "external") {
      const eb = tree.externalBeneficiaries?.find((x) => x.id === p.id);
      if (eb) return `${eb.name} Irrevocable Trust`;
    }
  }
  const suffix = { irrevocable: "Irrevocable Trust", slat: "SLAT", ilit: "ILIT", idgt: "IDGT" }[a.kind];
  return `${last} ${suffix}`;
}
