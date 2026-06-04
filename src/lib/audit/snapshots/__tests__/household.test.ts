import { describe, it, expect } from "vitest";
import { toHouseholdSnapshot } from "../household";

describe("toHouseholdSnapshot", () => {
  it("captures the human-meaningful household fields", () => {
    const snap = toHouseholdSnapshot({
      id: "h1",
      firmId: "f1",
      advisorId: "a1",
      name: "Smith",
      status: "active",
      notes: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      deletedBy: null,
    } as never);
    expect(snap).toEqual({
      name: "Smith",
      status: "active",
      advisorId: "a1",
      notes: null,
    });
  });
});
