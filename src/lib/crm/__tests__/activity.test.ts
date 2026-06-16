import { describe, it, expect, vi, beforeEach } from "vitest";

const insertValues = vi.fn();
const findFirst = vi.fn();
vi.mock("@/db", () => ({
  db: {
    query: { crmHouseholds: { findFirst: (...a: unknown[]) => findFirst(...a) } },
    insert: () => ({ values: (v: unknown) => insertValues(v) }),
  },
}));
// recordActivity must NOT call auth() anymore.
const auth = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({ auth: () => auth() }));

import { recordActivity } from "../activity";

beforeEach(() => { insertValues.mockReset(); findFirst.mockReset(); auth.mockReset(); });

describe("recordActivity (explicit actorUserId)", () => {
  it("writes the actor_user_id from the explicit opts param and never calls auth()", async () => {
    findFirst.mockResolvedValue({ firmId: "org_A" });
    await recordActivity(
      { householdId: "hh-1", kind: "call", title: "Quarterly call", occurredAt: new Date("2026-06-15") },
      { actorUserId: "advisor-77" },
    );
    expect(auth).not.toHaveBeenCalled();
    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({
      householdId: "hh-1", firmId: "org_A", actorUserId: "advisor-77", kind: "call",
    }));
  });
});
