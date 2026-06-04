import type { AccountOwner } from "@/engine/ownership";
import { boundedLevenshtein } from "./levenshtein";

export interface OwnerMatchFamilyMember {
  id: string;
  role: "client" | "spouse" | "child" | "other";
  firstName: string;
  lastName?: string | null;
}

// `hint` is space-padded before matching, so space-wrapped cues match whole
// words only (e.g. " joint " won't fire on "disjoint"). "jtwros"/"ten com" are
// distinctive enough to match as substrings.
const JOINT_CUES = ["jtwros", " joint ", " jt ", "ten com", " tenants ", " & ", " and "];

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z]+/i)
    .filter((t) => t.length >= 2);
}

function nameMatches(token: string, firstName: string): boolean {
  const fn = firstName.toLowerCase();
  if (token === fn) return true;
  // Allow a single typo only for names long enough that it isn't ambiguous.
  // boundedLevenshtein returns -1 when the distance exceeds the bound, so a
  // non-negative result means the token is within one edit of the name.
  if (fn.length >= 4 && boundedLevenshtein(token, fn, 1) >= 0) return true;
  return false;
}

function coarseFallback(
  coarse: "client" | "spouse" | "joint" | undefined,
  clientId: string | undefined,
  spouseId: string | undefined,
): AccountOwner[] {
  if (coarse === "joint" && clientId && spouseId) {
    return [
      { kind: "family_member", familyMemberId: clientId, percent: 0.5 },
      { kind: "family_member", familyMemberId: spouseId, percent: 0.5 },
    ];
  }
  if (coarse === "spouse" && spouseId) {
    return [{ kind: "family_member", familyMemberId: spouseId, percent: 1 }];
  }
  if (clientId) return [{ kind: "family_member", familyMemberId: clientId, percent: 1 }];
  return [];
}

/**
 * Resolve account ownership from the statement's registration-name hint, the
 * coarse client/spouse/joint enum, and the client's family roster. Pure.
 */
export function matchOwnersFromHint(
  hint: string | undefined,
  coarse: "client" | "spouse" | "joint" | undefined,
  family: OwnerMatchFamilyMember[],
): AccountOwner[] {
  const clientFm = family.find((f) => f.role === "client");
  const spouseFm = family.find((f) => f.role === "spouse");

  if (hint && hint.trim()) {
    const lower = ` ${hint.toLowerCase()} `;
    const tokens = tokenize(hint);
    const matched = family.filter((fm) => tokens.some((t) => nameMatches(t, fm.firstName)));
    const hasJointCue = JOINT_CUES.some((c) => lower.includes(c));

    // Joint when both spouses appear by name, or a joint cue + both exist.
    const includesClient = clientFm && matched.some((m) => m.id === clientFm.id);
    const includesSpouse = spouseFm && matched.some((m) => m.id === spouseFm.id);
    if (clientFm && spouseFm && ((includesClient && includesSpouse) || hasJointCue)) {
      return [
        { kind: "family_member", familyMemberId: clientFm.id, percent: 0.5 },
        { kind: "family_member", familyMemberId: spouseFm.id, percent: 0.5 },
      ];
    }
    if (matched.length === 1) {
      return [{ kind: "family_member", familyMemberId: matched[0].id, percent: 1 }];
    }
    // matched.length === 0 or an ambiguous >2 → fall through to coarse.
  }

  return coarseFallback(coarse, clientFm?.id, spouseFm?.id);
}
