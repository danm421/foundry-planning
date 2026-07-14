// mobile/src/profile/family.ts
//
// Pure form-state + validation for the profile screen's family section. No
// react, no api imports.
//
// Mirrors the API (src/app/api/portal/family/route.ts, src/app/api/portal/
// family/[id]/route.ts): firstName is required; dateOfBirth is either ""
// (cleared) or a strict YYYY-MM-DD; "" on a nullable field means "clear it"
// (-> null on the wire), same idiom as household.ts.
//
// The server's relationship enum (src/db/schema.ts familyRelationshipEnum)
// has more values than the mobile picker's 4-option subset below — e.g.
// "grandchild", "stepchild". fromMember() maps anything outside that subset
// to "other" so the picker always has a valid value to show, but the PUT
// route only patches whatever key is *present* on the request body — so an
// edit that never touches the relationship picker must omit `relationship`
// entirely from the update body, or a real "grandchild" would be silently
// downgraded to "other" on save. toFamilyBody() always emits whatever
// relationship is currently in form state; the screen component is what
// tracks whether the picker was touched and strips the key when it wasn't
// (this module has no notion of "dirty" — that's UI state, not form data).
import type { FamilyMemberInput, PortalFamilyMemberDTO, PortalFamilyRelationshipOption } from "@contracts";

export const RELATIONSHIP_OPTIONS: readonly PortalFamilyRelationshipOption[] = ["child", "parent", "sibling", "other"];

export interface FamilyFormState {
  firstName: string;
  lastName: string;
  relationship: PortalFamilyRelationshipOption;
  dateOfBirth: string; // "" stands in for a null field; "" or strict YYYY-MM-DD
}

const DOB_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Create-mode seed: relationship defaults to "child" (the API's own default
 *  when the field is omitted on POST). */
export function emptyFamilyForm(): FamilyFormState {
  return { firstName: "", lastName: "", relationship: "child", dateOfBirth: "" };
}

/** Edit-mode seed: hydrates form state from an existing member. A
 *  relationship outside the 4-option picker subset maps to "other" so the
 *  picker always has somewhere valid to land — see the module header for why
 *  that must not be silently written back on save. */
export function fromMember(m: PortalFamilyMemberDTO): FamilyFormState {
  const relationship = (RELATIONSHIP_OPTIONS as readonly string[]).includes(m.relationship)
    ? (m.relationship as PortalFamilyRelationshipOption)
    : "other";
  return {
    firstName: m.firstName,
    lastName: m.lastName ?? "",
    relationship,
    dateOfBirth: m.dateOfBirth ?? "",
  };
}

/** First validation error, or null if the form is submittable. Mirrors the
 *  API's field checks so a client-side rejection always matches what the
 *  server would also reject. */
export function validateFamily(f: FamilyFormState): string | null {
  if (f.firstName.trim() === "") return "First name is required.";
  if (f.dateOfBirth !== "" && !DOB_RE.test(f.dateOfBirth)) return "Date of birth must be YYYY-MM-DD.";
  return null;
}

/** Only call once validateFamily(f) === null. */
export function toFamilyBody(f: FamilyFormState): FamilyMemberInput {
  return {
    firstName: f.firstName.trim(),
    lastName: f.lastName === "" ? null : f.lastName,
    relationship: f.relationship,
    dateOfBirth: f.dateOfBirth === "" ? null : f.dateOfBirth,
  };
}
