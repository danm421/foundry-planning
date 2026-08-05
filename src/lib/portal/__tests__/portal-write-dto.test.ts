import { describe, expect, it } from "vitest";
import { findRefusedFlowField, PORTAL_REFUSED_FLOW_FIELDS } from "../portal-write-dto";

describe("findRefusedFlowField", () => {
  it.each(PORTAL_REFUSED_FLOW_FIELDS)("refuses a body carrying %s set to a uuid", (field) => {
    expect(findRefusedFlowField({ name: "Rent", [field]: "11111111-1111-1111-1111-111111111111" })).toBe(
      field,
    );
  });

  it.each(PORTAL_REFUSED_FLOW_FIELDS)("allows a body carrying %s set to null", (field) => {
    expect(findRefusedFlowField({ name: "Rent", [field]: null })).toBeNull();
  });

  it.each(PORTAL_REFUSED_FLOW_FIELDS)("allows a body carrying %s set to undefined", (field) => {
    expect(findRefusedFlowField({ name: "Rent", [field]: undefined })).toBeNull();
  });

  it("allows an ordinary body carrying only legitimate fields", () => {
    expect(
      findRefusedFlowField({
        name: "Rent",
        annualAmount: "1200",
        startYear: 2026,
        endYear: 2040,
        owner: "client",
        type: "other",
        isGoal: false,
      }),
    ).toBeNull();
  });

  it("allows an empty dedicatedAccountIds array — not an attempt to point at a hidden account", () => {
    expect(findRefusedFlowField({ name: "Rent", dedicatedAccountIds: [] })).toBeNull();
  });

  it("refuses a non-empty dedicatedAccountIds array", () => {
    expect(
      findRefusedFlowField({ name: "Rent", dedicatedAccountIds: ["11111111-1111-1111-1111-111111111111"] }),
    ).toBe("dedicatedAccountIds");
  });

  it("reports the first refused field when a body carries more than one", () => {
    expect(
      findRefusedFlowField({
        ownerEntityId: "e1",
        cashAccountId: "a1",
      }),
    ).toBe("ownerEntityId");
  });

  it.each([null, undefined, [], "not an object", 42, true])(
    "treats non-object input %j as carrying no refused field, without throwing",
    (input) => {
      expect(() => findRefusedFlowField(input)).not.toThrow();
      expect(findRefusedFlowField(input)).toBeNull();
    },
  );
});
