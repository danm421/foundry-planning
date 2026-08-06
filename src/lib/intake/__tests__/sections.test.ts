import { describe, it, expect } from "vitest";
import {
  DEFAULT_INTAKE_SECTIONS,
  normalizeSections,
  sectionsForForm,
  forceFamilyForProspect,
  matchPreset,
  INTAKE_SECTION_PRESETS,
} from "../sections";

describe("normalizeSections", () => {
  it("returns canonical order regardless of input order", () => {
    expect(normalizeSections(["documents", "family", "income"])).toEqual([
      "family",
      "income",
      "documents",
    ]);
  });

  it("de-duplicates", () => {
    expect(normalizeSections(["goals", "goals"])).toEqual(["goals"]);
  });

  it("drops unknown keys rather than throwing", () => {
    expect(normalizeSections(["family", "retired_section", 7, null])).toEqual(["family"]);
  });

  it("returns [] for a non-array", () => {
    expect(normalizeSections(null)).toEqual([]);
    expect(normalizeSections("family")).toEqual([]);
  });
});

describe("sectionsForForm", () => {
  it("treats null as the default set", () => {
    expect(sectionsForForm(null)).toEqual([...DEFAULT_INTAKE_SECTIONS]);
  });

  it("treats an empty stored array as the default set", () => {
    expect(sectionsForForm([])).toEqual([...DEFAULT_INTAKE_SECTIONS]);
  });

  it("treats an all-unknown stored array as the default set", () => {
    expect(sectionsForForm(["gone"])).toEqual([...DEFAULT_INTAKE_SECTIONS]);
  });

  it("passes a real stored set through in canonical order", () => {
    expect(sectionsForForm(["risk", "family"])).toEqual(["family", "risk"]);
  });

  it("does not include risk in the default set", () => {
    expect(DEFAULT_INTAKE_SECTIONS).not.toContain("risk");
  });
});

describe("forceFamilyForProspect", () => {
  it("adds family, in canonical position, when there is no client", () => {
    expect(forceFamilyForProspect(["documents"], false)).toEqual(["family", "documents"]);
  });

  it("leaves an existing-client set alone", () => {
    expect(forceFamilyForProspect(["documents"], true)).toEqual(["documents"]);
  });

  it("is a no-op when family is already present", () => {
    expect(forceFamilyForProspect(["family", "goals"], false)).toEqual(["family", "goals"]);
  });
});

describe("matchPreset", () => {
  it("matches the full preset regardless of input order", () => {
    expect(matchPreset(["goals", "family", "documents", "accounts", "income", "property"]))
      .toBe("full");
  });

  it("returns null for a set no preset covers", () => {
    expect(matchPreset(["family", "accounts"])).toBeNull();
  });

  it("every preset round-trips through matchPreset", () => {
    for (const p of INTAKE_SECTION_PRESETS) {
      expect(matchPreset(p.sections)).toBe(p.key);
    }
  });
});
