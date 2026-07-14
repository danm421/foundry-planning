// mobile/src/profile/family.test.ts
//
// Pure-fn tests for the profile family section: form seeding (emptyFamilyForm,
// fromMember), validation (validateFamily), and the wire-body mapper
// (toFamilyBody). Mirrors the API (src/app/api/portal/family/route.ts,
// src/app/api/portal/family/[id]/route.ts): firstName is required;
// dateOfBirth is either "" or a strict YYYY-MM-DD; "" on a nullable field
// means "clear it" (-> null on the wire). The server's relationship enum
// (src/db/schema.ts familyRelationshipEnum) has more values than the mobile
// picker's 4-option subset (child/parent/sibling/other) — fromMember maps
// anything outside that subset (e.g. "grandchild") to "other" for the picker
// alone; toFamilyBody always emits whatever relationship is currently in
// form state (the "don't silently downgrade" dirty-flag logic lives in the
// screen component, not here).
import { describe, it, expect } from "vitest";
import {
  RELATIONSHIP_OPTIONS,
  emptyFamilyForm,
  fromMember,
  validateFamily,
  toFamilyBody,
  type FamilyFormState,
} from "./family";
import type { PortalFamilyMemberDTO } from "@contracts";

const member = (over: Partial<PortalFamilyMemberDTO> = {}): PortalFamilyMemberDTO => ({
  id: "m1",
  firstName: "Alex",
  lastName: "Smith",
  relationship: "child",
  dateOfBirth: "2015-04-02",
  ...over,
});

describe("RELATIONSHIP_OPTIONS", () => {
  it("is the 4-option picker subset, in order", () => {
    expect(RELATIONSHIP_OPTIONS).toEqual(["child", "parent", "sibling", "other"]);
  });
});

describe("emptyFamilyForm", () => {
  it("seeds relationship \"child\" (API default) and blank text fields", () => {
    expect(emptyFamilyForm()).toEqual({
      firstName: "",
      lastName: "",
      relationship: "child",
      dateOfBirth: "",
    });
  });
});

describe("fromMember", () => {
  it("maps a full member straight across when relationship is in the picker subset", () => {
    expect(fromMember(member())).toEqual({
      firstName: "Alex",
      lastName: "Smith",
      relationship: "child",
      dateOfBirth: "2015-04-02",
    });
  });

  it("maps null lastName/dateOfBirth to \"\"", () => {
    expect(fromMember(member({ lastName: null, dateOfBirth: null }))).toEqual({
      firstName: "Alex",
      lastName: "",
      relationship: "child",
      dateOfBirth: "",
    });
  });

  it("maps a relationship outside the 4-option subset (e.g. \"grandchild\") to \"other\" for the picker", () => {
    const f = fromMember(member({ relationship: "grandchild" }));
    expect(f.relationship).toBe("other");
  });

  it("leaves a real \"other\" relationship as \"other\"", () => {
    const f = fromMember(member({ relationship: "other" }));
    expect(f.relationship).toBe("other");
  });
});

describe("validateFamily", () => {
  const base: FamilyFormState = { firstName: "Alex", lastName: "", relationship: "child", dateOfBirth: "" };

  it("passes with just a firstName and no DOB", () => {
    expect(validateFamily(base)).toBeNull();
  });

  it("rejects a blank firstName", () => {
    expect(validateFamily({ ...base, firstName: "" })).not.toBeNull();
  });

  it("rejects a whitespace-only firstName", () => {
    expect(validateFamily({ ...base, firstName: "   " })).not.toBeNull();
  });

  it("rejects a loosely-formatted DOB (\"2020-1-5\")", () => {
    expect(validateFamily({ ...base, dateOfBirth: "2020-1-5" })).not.toBeNull();
  });

  it("accepts a strict YYYY-MM-DD DOB (\"2020-01-05\")", () => {
    expect(validateFamily({ ...base, dateOfBirth: "2020-01-05" })).toBeNull();
  });

  it("accepts a blank (\"\") DOB", () => {
    expect(validateFamily({ ...base, dateOfBirth: "" })).toBeNull();
  });
});

describe("toFamilyBody", () => {
  it("maps a full form straight across", () => {
    expect(toFamilyBody({ firstName: "Alex", lastName: "Smith", relationship: "child", dateOfBirth: "2015-04-02" }))
      .toEqual({ firstName: "Alex", lastName: "Smith", relationship: "child", dateOfBirth: "2015-04-02" });
  });

  it("maps \"\" lastName to null", () => {
    const body = toFamilyBody({ firstName: "Alex", lastName: "", relationship: "child", dateOfBirth: "2015-04-02" });
    expect(body.lastName).toBeNull();
  });

  it("maps \"\" dateOfBirth to null", () => {
    const body = toFamilyBody({ firstName: "Alex", lastName: "Smith", relationship: "child", dateOfBirth: "" });
    expect(body.dateOfBirth).toBeNull();
  });

  it("maps both \"\" lastName and \"\" dateOfBirth to null together", () => {
    const body = toFamilyBody({ firstName: "Alex", lastName: "", relationship: "sibling", dateOfBirth: "" });
    expect(body).toEqual({ firstName: "Alex", lastName: null, relationship: "sibling", dateOfBirth: null });
  });
});
