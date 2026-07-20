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
import * as actorNameModule from "@/lib/audit/actor-name";

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

describe("recordActivity (actor name snapshot)", () => {
  it("normalizes a blank actor id to 'system'", async () => {
    findFirst.mockResolvedValue({ firmId: "org_A" });
    await recordActivity(
      { householdId: "hh-1", kind: "note", title: "Household created", occurredAt: new Date("2026-06-15") },
      { actorUserId: "" },
    );
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: "system" }),
    );
  });

  it("preserves caller metadata when no name resolves", async () => {
    findFirst.mockResolvedValue({ firmId: "org_A" });
    await recordActivity(
      {
        householdId: "hh-1",
        kind: "contact_change",
        title: "Updated primary: Michael Mitchell",
        metadata: { contactId: "c-1" },
        occurredAt: new Date("2026-06-15"),
      },
      { actorUserId: "advisor-77" },
    );
    const [values] = insertValues.mock.calls[0]!;
    expect(values.metadata).toMatchObject({ contactId: "c-1" });
  });

  it("merges the resolved actorName into caller metadata alongside the caller's own keys", async () => {
    findFirst.mockResolvedValue({ firmId: "org_A" });
    const spy = vi
      .spyOn(actorNameModule, "snapshotActorName")
      .mockResolvedValue("Jane Advisor");
    try {
      await recordActivity(
        {
          householdId: "hh-1",
          kind: "contact_change",
          title: "Updated primary: Michael Mitchell",
          metadata: { contactId: "c-1" },
          occurredAt: new Date("2026-06-15"),
        },
        { actorUserId: "user_advisor_77" },
      );
    } finally {
      spy.mockRestore();
    }
    const [values] = insertValues.mock.calls[0]!;
    expect(values.metadata).toEqual({ contactId: "c-1", actorName: "Jane Advisor" });
  });
});
