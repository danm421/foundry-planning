import { describe, expect, it } from "vitest";
import { FAMILY_PROMPT, FAMILY_VERSION } from "../prompts/family";

describe("FAMILY_PROMPT", () => {
  it("was bumped for the age fields", () => {
    expect(FAMILY_VERSION).toBe("2026-07-23.1");
  });

  it("asks for the Profile table's age columns", () => {
    expect(FAMILY_PROMPT).toContain("retirementAge");
    expect(FAMILY_PROMPT).toContain("lifeExpectancy");
    expect(FAMILY_PROMPT).toContain("stateOfResidence");
  });

  it("still forbids extracting government identifiers", () => {
    expect(FAMILY_PROMPT).toContain("Social Security Numbers");
  });

  it("does not ask for ages on dependents", () => {
    const dependentsBlock = FAMILY_PROMPT.slice(FAMILY_PROMPT.indexOf('"dependents"'));
    expect(dependentsBlock).not.toContain("retirementAge");
  });
});
