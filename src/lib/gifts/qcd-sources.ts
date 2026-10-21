import type { Account } from "@/engine/types";
import { isTraditionalIra } from "@/engine/ira-basis";
import { qcdEligibleFromYear } from "@/engine/qcd";
import { getRmdStartAge } from "@/engine/rmd";
import { CO_CLIENT_LABEL } from "@/lib/owner-labels";

/** One IRA a QCD can be paid from, with the facts the gift form needs about its
 *  owner: who they are, when QCDs start, and when the RMD does. */
export interface QcdSourceOption {
  id: string;
  name: string;
  owner: "client" | "spouse";
  ownerFirstName: string;
  /** The OTHER principal, for the carry-on line; null when single. */
  spouseFirstName: string | null;
  /** `qcdEligibleFromYear(owner DOB)`. */
  eligibleFromYear: number;
  /** Birth year + the owner's RMD start age. */
  rmdStartYear: number;
  /** An inherited IRA (`isInheritedIra`): its RMDs are already due, whatever
   *  the owner's age. */
  inherited: boolean;
}

export interface QcdSourceInput {
  accounts: Array<{
    id: string;
    name: string;
    category: string;
    subType: string;
    ownerFamilyMemberId: string | null;
    ownerEntityId?: string | null;
    /** `isInheritedIra(account)`, worked out by the caller that holds the full account. */
    inherited?: boolean;
  }>;
  familyMembers: Array<{ id: string; role: string; firstName: string; dateOfBirth: string | null }>;
}

/** The QCD source an account is, or the sentence saying why it isn't one. */
function classify(
  a: QcdSourceInput["accounts"][number],
  principals: QcdSourceInput["familyMembers"],
): QcdSourceOption | string {
  const notOwnedAlone = `${a.name} isn't owned by the client or ${CO_CLIENT_LABEL.toLowerCase()} alone, so it can't fund a QCD.`;
  if (a.ownerEntityId != null || a.ownerFamilyMemberId == null) return notOwnedAlone;
  if (!isTraditionalIra({ category: a.category as Account["category"], subType: a.subType })) {
    return `${a.name} isn't a traditional, SEP or SIMPLE IRA, so it can't fund a QCD.`;
  }
  const owner = principals.find((m) => m.id === a.ownerFamilyMemberId);
  if (!owner) return notOwnedAlone;
  if (!owner.dateOfBirth) {
    return `${owner.firstName} has no date of birth on file, so ${a.name} can't fund a QCD.`;
  }
  const other = principals.find((m) => m.id !== owner.id);
  const birthYear = parseInt(owner.dateOfBirth.slice(0, 4), 10);
  return {
    id: a.id,
    name: a.name,
    owner: owner.role as "client" | "spouse",
    ownerFirstName: owner.firstName,
    spouseFirstName: other?.firstName ?? null,
    eligibleFromYear: qcdEligibleFromYear(owner.dateOfBirth),
    rmdStartYear: birthYear + getRmdStartAge(birthYear),
    inherited: a.inherited === true,
  };
}

function principalsOf(input: QcdSourceInput) {
  return input.familyMembers.filter((m) => m.role === "client" || m.role === "spouse");
}

/** The client's and spouse's traditional, SEP and SIMPLE IRAs. A QCD is paid by
 *  the IRA's owner, so an entity-owned or jointly-titled account, an owner who
 *  isn't a principal, and an owner with no date of birth all drop out. */
export function qcdSourceOptions(input: QcdSourceInput): QcdSourceOption[] {
  const principals = principalsOf(input);
  return input.accounts
    .map((a) => classify(a, principals))
    .filter((c): c is QcdSourceOption => typeof c !== "string");
}

/** Why each account `qcdSourceOptions` leaves out can't fund a QCD, keyed by
 *  account id — so a saved QCD the form can no longer offer can say why. */
export function qcdSourceProblems(input: QcdSourceInput): Record<string, string> {
  const principals = principalsOf(input);
  const out: Record<string, string> = {};
  for (const a of input.accounts) {
    const c = classify(a, principals);
    if (typeof c === "string") out[a.id] = c;
  }
  return out;
}
