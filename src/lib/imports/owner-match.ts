import type { AccountOwner } from "@/engine/ownership";
import { boundedLevenshtein } from "./levenshtein";

export interface OwnerMatchFamilyMember {
  id: string;
  role: "client" | "spouse" | "child" | "other";
  firstName: string;
  lastName?: string | null;
}

/**
 * Where a resolution's ownership actually came from.
 *
 * - `"hint"` — the registration name resolved to a named family member, or a
 *   joint cue fired with both spouses present.
 * - `"coarse"` — the client/spouse/joint enum resolved against a roster that
 *   actually contains the person(s) it names.
 * - `"default"` — nothing resolved. Any owners present are the "somebody has
 *   to own it, so use the client" write default, NOT evidence. This includes
 *   `coarse: "spouse"` or `"joint"` silently degrading to the client because
 *   the roster has no spouse — that degradation is a fabrication too.
 *
 * Callers that *write* ownership want the owners regardless of source. Callers
 * that treat ownership as *evidence* — the import matching pass — take `"hint"`
 * only. `"default"` is a fabrication, and `"coarse"` is a model guess the
 * extraction prompt asks for on every row, so neither can be told apart from a
 * confident right answer by a scorer that only knows "agrees" and "disagrees".
 * See `resolveOwnerIds` in `match.ts` for what that costs and why it is worth it.
 */
export type OwnerResolutionSource = "hint" | "coarse" | "default";

export interface OwnerResolution {
  owners: AccountOwner[];
  source: OwnerResolutionSource;
}

// `hint` is space-padded before matching, so space-wrapped cues match whole
// words only (e.g. " joint " won't fire on "disjoint"). "jtwros"/"ten com" are
// distinctive enough to match as substrings.
const JOINT_CUES = ["jtwros", " joint ", " jt ", "ten com", " tenants ", " & ", " and "];

// Drops digits deliberately — this tokenizes person-name hints, where digits
// are noise. Contrast `match-keys/account.ts`'s `tokens`, which keeps them.
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
): OwnerResolution {
  if (coarse === "joint" && clientId && spouseId) {
    return {
      owners: [
        { kind: "family_member", familyMemberId: clientId, percent: 0.5 },
        { kind: "family_member", familyMemberId: spouseId, percent: 0.5 },
      ],
      source: "coarse",
    };
  }
  if (coarse === "spouse" && spouseId) {
    return {
      owners: [{ kind: "family_member", familyMemberId: spouseId, percent: 1 }],
      source: "coarse",
    };
  }
  if (clientId) {
    // Reached three ways: as genuine `coarse: "client"` evidence, with no
    // coarse enum at all, or as the silent degrade when "spouse"/"joint"
    // named somebody this roster does not have. Only the first is evidence.
    return {
      owners: [{ kind: "family_member", familyMemberId: clientId, percent: 1 }],
      source: coarse === "client" ? "coarse" : "default",
    };
  }
  return { owners: [], source: "default" };
}

/**
 * Resolve account ownership from the statement's registration-name hint, the
 * coarse client/spouse/joint enum, and the client's family roster, reporting
 * *where* the answer came from. Pure.
 *
 * The owners are identical to what `matchOwnersFromHint` returns; the only
 * addition is `source`, which distinguishes a resolution backed by evidence
 * from the trailing "somebody has to own it" default. See
 * `OwnerResolutionSource`.
 */
export function resolveOwnersFromHint(
  hint: string | undefined,
  coarse: "client" | "spouse" | "joint" | undefined,
  family: OwnerMatchFamilyMember[],
): OwnerResolution {
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
      return {
        owners: [
          { kind: "family_member", familyMemberId: clientFm.id, percent: 0.5 },
          { kind: "family_member", familyMemberId: spouseFm.id, percent: 0.5 },
        ],
        source: "hint",
      };
    }
    if (matched.length === 1) {
      return {
        owners: [{ kind: "family_member", familyMemberId: matched[0].id, percent: 1 }],
        source: "hint",
      };
    }
    // matched.length === 0 or an ambiguous >2 → fall through to coarse.
  }

  return coarseFallback(coarse, clientFm?.id, spouseFm?.id);
}

/**
 * Resolve account ownership from the statement's registration-name hint, the
 * coarse client/spouse/joint enum, and the client's family roster. Pure.
 *
 * Always yields owners when the roster has a client, because the commit step
 * has to write *somebody* as the owner. Callers scoring ownership as evidence
 * want `resolveOwnersFromHint` and its `source` instead.
 */
export function matchOwnersFromHint(
  hint: string | undefined,
  coarse: "client" | "spouse" | "joint" | undefined,
  family: OwnerMatchFamilyMember[],
): AccountOwner[] {
  return resolveOwnersFromHint(hint, coarse, family).owners;
}
