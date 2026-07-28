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
        insert: () => ({
          values: (v: Record<string, unknown>) => {
            if ("kind" in v) insertedEvents.push(v);
            else profileRow.current = { ...v, id: "p1" };
            return { returning: async () => [profileRow.current] };
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

import { recomputeProfile } from "../profile";

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
