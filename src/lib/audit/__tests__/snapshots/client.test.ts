// src/lib/audit/__tests__/snapshots/client.test.ts
import { describe, it, expect } from "vitest";
import { clients } from "@/db/schema";
import { toClientSnapshot } from "../../snapshots/client";

const row: typeof clients.$inferSelect = {
  id: "cli1",
  firmId: "firm1",
  advisorId: "user_1",
  firstName: "Jane",
  lastName: "Doe",
  dateOfBirth: "1980-01-15",
  retirementAge: 65,
  planEndAge: 95,
  lifeExpectancy: 92,
  spouseName: "John",
  spouseLastName: "Doe",
  spouseDob: "1981-03-22",
  spouseRetirementAge: 67,
  spouseLifeExpectancy: 90,
  filingStatus: "married_joint",
  email: "jane@example.com",
  address: "123 Main St",
  spouseEmail: "john@example.com",
  spouseAddress: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("toClientSnapshot", () => {
  it("drops PII fields", () => {
    const snap = toClientSnapshot(row);
    expect(snap).not.toHaveProperty("email");
    expect(snap).not.toHaveProperty("address");
    expect(snap).not.toHaveProperty("spouseEmail");
    expect(snap).not.toHaveProperty("spouseAddress");
  });

  it("keeps identity and plan-horizon fields", () => {
    const snap = toClientSnapshot(row);
    expect(snap).toMatchObject({
      firstName: "Jane",
      lastName: "Doe",
      dateOfBirth: "1980-01-15",
      retirementAge: 65,
      planEndAge: 95,
      lifeExpectancy: 92,
      spouseName: "John",
      spouseLastName: "Doe",
      spouseDob: "1981-03-22",
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
