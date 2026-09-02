// src/lib/integrations/__tests__/claim-household.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const insertValues = vi.fn();
vi.mock("@/db", () => ({
  db: {
    insert: () => ({
      values: (v: unknown) => {
        insertValues(v);
        return { onConflictDoUpdate: () => mockInsertOutcome() };
      },
    }),
  },
}));

let mockInsertOutcome: () => Promise<unknown> = async () => undefined;

import { claimHousehold } from "../households";

beforeEach(() => {
  vi.clearAllMocks();
  mockInsertOutcome = async () => undefined;
});

const base = {
  firmId: "firm_1",
  providerId: "addepar" as const,
  clientId: "c1",
  userId: "u1",
};

describe("claimHousehold", () => {
  it("returns unknown_household when the id is not in the firm's book", async () => {
    const result = await claimHousehold({
      ...base,
      externalHouseholdId: "9999999",
      listHouseholds: async () => [{ id: "1234567", name: "Doe Family" }],
    });
    expect(result).toEqual({ ok: false, reason: "unknown_household" });
    expect(insertValues).not.toHaveBeenCalled();
  });

  it("links and returns the household name on success", async () => {
    const result = await claimHousehold({
      ...base,
      externalHouseholdId: "1234567",
      listHouseholds: async () => [{ id: "1234567", name: "Doe Family" }],
    });
    expect(result).toEqual({ ok: true, name: "Doe Family" });
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        firmId: "firm_1",
        provider: "addepar",
        clientId: "c1",
        externalHouseholdId: "1234567",
        linkedByUserId: "u1",
      }),
    );
  });

  it("maps a unique violation to already_linked rather than throwing", async () => {
    mockInsertOutcome = async () => {
      throw Object.assign(new Error("duplicate key"), { code: "23505" });
    };
    const result = await claimHousehold({
      ...base,
      externalHouseholdId: "1234567",
      listHouseholds: async () => [{ id: "1234567", name: "Doe Family" }],
    });
    expect(result).toEqual({ ok: false, reason: "already_linked" });
  });

  it("rethrows a non-unique DB error (never silently reports already_linked)", async () => {
    mockInsertOutcome = async () => {
      throw Object.assign(new Error("connection lost"), { code: "08006" });
    };
    await expect(
      claimHousehold({
        ...base,
        externalHouseholdId: "1234567",
        listHouseholds: async () => [{ id: "1234567", name: "Doe Family" }],
      }),
    ).rejects.toThrow("connection lost");
  });
});
