import { describe, it, expect } from "vitest";
import {
  ownedByEntity,
  ownedByHousehold,
  ownedByFamilyMember,
  isFullyEntityOwned,
  isFullyHouseholdOwned,
  controllingFamilyMember,
  type AccountOwner,
} from "../ownership";

const fmClient = (pct: number): AccountOwner => ({
  kind: "family_member", familyMemberId: "fm-client", percent: pct,
});
const fmSpouse = (pct: number): AccountOwner => ({
  kind: "family_member", familyMemberId: "fm-spouse", percent: pct,
});
const entTrust = (pct: number, id = "ent-trust"): AccountOwner => ({
  kind: "entity", entityId: id, percent: pct,
});

describe("ownership helpers", () => {
  it("ownedByHousehold sums all family_member rows", () => {
    expect(ownedByHousehold({ owners: [fmClient(0.5), fmSpouse(0.5)] })).toBe(1.0);
    expect(ownedByHousehold({ owners: [fmClient(0.6), entTrust(0.4)] })).toBeCloseTo(0.6);
    expect(ownedByHousehold({ owners: [entTrust(1.0)] })).toBe(0);
  });

  it("ownedByEntity returns matching entity row's pct or 0", () => {
    expect(ownedByEntity({ owners: [fmClient(0.5), entTrust(0.5)] }, "ent-trust")).toBe(0.5);
    expect(ownedByEntity({ owners: [entTrust(0.5, "other")] }, "ent-trust")).toBe(0);
    expect(ownedByEntity({ owners: [fmClient(1.0)] }, "ent-trust")).toBe(0);
  });

  it("ownedByFamilyMember returns matching family_member row's pct or 0", () => {
    expect(ownedByFamilyMember({ owners: [fmClient(0.7), fmSpouse(0.3)] }, "fm-client")).toBe(0.7);
    expect(ownedByFamilyMember({ owners: [entTrust(1.0)] }, "fm-client")).toBe(0);
  });

  it("isFullyEntityOwned true only when all rows are entity and sum to 1", () => {
    expect(isFullyEntityOwned({ owners: [entTrust(1.0)] })).toBe(true);
    expect(isFullyEntityOwned({ owners: [entTrust(0.5, "a"), entTrust(0.5, "b")] })).toBe(true);
    expect(isFullyEntityOwned({ owners: [entTrust(0.5), fmClient(0.5)] })).toBe(false);
    expect(isFullyEntityOwned({ owners: [fmClient(1.0)] })).toBe(false);
    expect(isFullyEntityOwned({ owners: [] })).toBe(false);
  });

  it("isFullyHouseholdOwned true only when all rows are family_member", () => {
    expect(isFullyHouseholdOwned({ owners: [fmClient(1.0)] })).toBe(true);
    expect(isFullyHouseholdOwned({ owners: [fmClient(0.5), fmSpouse(0.5)] })).toBe(true);
    expect(isFullyHouseholdOwned({ owners: [fmClient(0.5), entTrust(0.5)] })).toBe(false);
    expect(isFullyHouseholdOwned({ owners: [] })).toBe(false);
  });

  it("controllingFamilyMember returns the sole family_member id when there is exactly one at 100%, else null", () => {
    expect(controllingFamilyMember({ owners: [fmClient(1.0)] })).toBe("fm-client");
    expect(controllingFamilyMember({ owners: [fmClient(0.5), fmSpouse(0.5)] })).toBe(null);
    expect(controllingFamilyMember({ owners: [entTrust(1.0)] })).toBe(null);
    expect(controllingFamilyMember({ owners: [fmClient(0.7), entTrust(0.3)] })).toBe(null);
  });
});
