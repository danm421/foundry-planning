import type { Account } from "@/engine/types";
import { isTraditionalIra } from "@/engine/ira-basis";
import { qcdEligibleFromYear } from "@/engine/qcd";
import { getRmdStartAge } from "@/engine/rmd";

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
}

/** The client's and spouse's traditional, SEP and SIMPLE IRAs. A QCD is paid by
 *  the IRA's owner, so an entity-owned or jointly-titled account, an owner who
 *  isn't a principal, and an owner with no date of birth all drop out. */
export function qcdSourceOptions(input: {
  accounts: Array<{
    id: string;
    name: string;
    category: string;
    subType: string;
    ownerFamilyMemberId: string | null;
    ownerEntityId?: string | null;
  }>;
  familyMembers: Array<{ id: string; role: string; firstName: string; dateOfBirth: string | null }>;
}): QcdSourceOption[] {
  const principals = input.familyMembers.filter((m) => m.role === "client" || m.role === "spouse");
  const out: QcdSourceOption[] = [];
  for (const a of input.accounts) {
    if (a.ownerEntityId != null || a.ownerFamilyMemberId == null) continue;
    if (!isTraditionalIra({ category: a.category as Account["category"], subType: a.subType })) continue;
    const owner = principals.find((m) => m.id === a.ownerFamilyMemberId);
    if (!owner || !owner.dateOfBirth) continue;
    const other = principals.find((m) => m.id !== owner.id);
    const birthYear = parseInt(owner.dateOfBirth.slice(0, 4), 10);
    out.push({
      id: a.id,
      name: a.name,
      owner: owner.role as "client" | "spouse",
      ownerFirstName: owner.firstName,
      spouseFirstName: other?.firstName ?? null,
      eligibleFromYear: qcdEligibleFromYear(owner.dateOfBirth),
      rmdStartYear: birthYear + getRmdStartAge(birthYear),
    });
  }
  return out;
}
