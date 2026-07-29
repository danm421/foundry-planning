import { describe, it, expect, vi, beforeEach } from "vitest";

const { insertedEvents, profileRow } = vi.hoisted(() => ({
  insertedEvents: [] as Array<Record<string, unknown>>,
  profileRow: { current: null as Record<string, unknown> | null },
}));

vi.mock("@/db", () => ({
  db: {
    query: {
      clientRiskProfiles: {
        findFirst: vi.fn(async () => profileRow.current),
      },
    },
    transaction: vi.fn(async (cb: (tx: unknown) => unknown) =>
      cb({
        // Mirrors `tx.select().from(...).where(...).for("update")`: the
        // in-transaction read that replaced the pre-transaction
        // `db.query....findFirst` lookup.
        select: () => ({
          from: () => ({
            where: () => ({
              for: async () => (profileRow.current ? [profileRow.current] : []),
            }),
          }),
        }),
        insert: () => ({
          values: (v: Record<string, unknown>) => {
            if ("kind" in v) {
              insertedEvents.push(v);
              return { returning: async () => [null] };
            }
            // client_risk_profiles insert -- only reached via
            // onConflictDoUpdate().returning() in the no-existing-row branch.
            return {
              onConflictDoUpdate: () => ({
                returning: async () => {
                  profileRow.current = { ...v, id: "p1" };
                  return [profileRow.current];
                },
              }),
            };
          },
        }),
        update: () => ({
          set: (v: Record<string, unknown>) => ({
            where: () => ({
              returning: async () => {
                profileRow.current = { ...profileRow.current, ...v };
                return [profileRow.current];
              },
            }),
          }),
        }),
      }),
    ),
  },
}));

import { db } from "@/db";
import { recomputeProfile, ensureProfile } from "../profile";

const BASE = { clientId: "c1", firmId: "f1", actorUserId: "u1", reason: null };

beforeEach(() => {
  insertedEvents.length = 0;
  profileRow.current = {
    id: "p1",
    clientId: "c1",
    firmId: "f1",
    toleranceScore: 70,
    capacityScore: 62,
    environmentAdj: 0,
    compositeScore: 62,
    compositeLevel: "moderately_aggressive",
    bindingConstraint: "capacity",
  };
});

describe("recomputeProfile", () => {
  it("writes no event when capacity drifts inside the same band", async () => {
    // 62 -> 64: still moderately_aggressive.
    await recomputeProfile({ ...BASE, kind: "capacity_changed", patch: { capacityScore: 64 } });
    expect(insertedEvents).toHaveLength(0);
  });

  it("writes an event when capacity drift crosses a band", async () => {
    // 62 -> 55: moderately_aggressive -> moderate.
    await recomputeProfile({ ...BASE, kind: "capacity_changed", patch: { capacityScore: 55 } });
    expect(insertedEvents).toHaveLength(1);
    expect(insertedEvents[0]).toMatchObject({
      kind: "capacity_changed",
      beforeLevel: "moderately_aggressive",
      afterLevel: "moderate",
      afterScore: 55,
    });
  });

  it("always writes an event for advisor-driven changes, band or no band", async () => {
    await recomputeProfile({
      ...BASE,
      kind: "environment_changed",
      reason: "Sole earner, employer announced layoffs",
      patch: { environmentAdj: -2, environmentReason: "Sole earner, employer announced layoffs" },
    });
    expect(insertedEvents).toHaveLength(1);
    expect(insertedEvents[0]).toMatchObject({ kind: "environment_changed" });
  });

  it("recomputes the composite from the patched inputs", async () => {
    await recomputeProfile({ ...BASE, kind: "tolerance_manual", reason: "Client call", patch: { toleranceScore: 30 } });
    expect(profileRow.current).toMatchObject({
      compositeScore: 30,
      compositeLevel: "moderately_conservative",
      bindingConstraint: "tolerance",
    });
  });

  it("freezes the three components on the event", async () => {
    await recomputeProfile({ ...BASE, kind: "tolerance_manual", reason: "Client call", patch: { toleranceScore: 30 } });
    expect(insertedEvents[0].components).toEqual({
      tolerance: 30,
      capacity: 62,
      environmentAdj: 0,
    });
  });
});

describe("ensureProfile", () => {
  it("short-circuits when a profile already exists, writing no duplicate event", async () => {
    const seeded = profileRow.current;
    // `db.transaction` is a shared vi.fn() with call history from earlier
    // tests in this file, so assert against a delta rather than "never
    // called" -- what matters is that ensureProfile adds zero calls.
    const txCallsBefore = vi.mocked(db.transaction).mock.calls.length;

    const first = await ensureProfile("c1", "f1", "u1");
    expect(insertedEvents).toHaveLength(0);
    expect(vi.mocked(db.transaction).mock.calls).toHaveLength(txCallsBefore);
    expect(first).toEqual(seeded);

    const second = await ensureProfile("c1", "f1", "u1");
    expect(insertedEvents).toHaveLength(0);
    expect(vi.mocked(db.transaction).mock.calls).toHaveLength(txCallsBefore);
    expect(second).toEqual(seeded);
  });
});
