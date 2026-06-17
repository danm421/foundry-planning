// src/lib/audit/__tests__/snapshots/client.test.ts
import { describe, it, expect } from "vitest";
import { clients } from "@/db/schema";
import { toClientSnapshot } from "../../snapshots/client";

const row: typeof clients.$inferSelect = {
  id: "cli1",
  firmId: "firm1",
  advisorId: "user_1",
  retirementAge: 65,
  retirementMonth: 1,
  planEndAge: 95,
  lifeExpectancy: 92,
  spouseRetirementAge: 67,
  spouseRetirementMonth: null,
  spouseLifeExpectancy: 90,
  filingStatus: "married_joint",
  isPrivate: false,
  onboardingState: {},
  onboardingCompletedAt: null,
  quickStartState: {},
  createdAt: new Date(),
  updatedAt: new Date(),
  crmHouseholdId: "00000000-0000-0000-0000-000000000000",
};

describe("toClientSnapshot", () => {
  it("does not project identity or PII fields (those live on CRM contacts)", () => {
    const snap = toClientSnapshot(row);
    expect(snap).not.toHaveProperty("firstName");
    expect(snap).not.toHaveProperty("lastName");
    expect(snap).not.toHaveProperty("dateOfBirth");
    expect(snap).not.toHaveProperty("email");
    expect(snap).not.toHaveProperty("address");
    expect(snap).not.toHaveProperty("spouseName");
    expect(snap).not.toHaveProperty("spouseLastName");
    expect(snap).not.toHaveProperty("spouseDob");
    expect(snap).not.toHaveProperty("spouseEmail");
    expect(snap).not.toHaveProperty("spouseAddress");
  });

  it("keeps planning fields", () => {
    const snap = toClientSnapshot(row);
    expect(snap).toMatchObject({
      retirementAge: 65,
      retirementMonth: 1,
      planEndAge: 95,
      lifeExpectancy: 92,
      spouseRetirementAge: 67,
      spouseLifeExpectancy: 90,
      filingStatus: "married_joint",
    });
  });

  it("drops system fields", () => {
    const snap = toClientSnapshot(row);
    expect(snap).not.toHaveProperty("id");
    expect(snap).not.toHaveProperty("firmId");
    expect(snap).not.toHaveProperty("advisorId");
    expect(snap).not.toHaveProperty("createdAt");
    expect(snap).not.toHaveProperty("updatedAt");
  });
});
