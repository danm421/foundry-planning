// src/lib/scenario/__tests__/delta-preview.test.ts
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/db";
import { scenarios, scenarioChanges, scenarioToggleGroups } from "@/db/schema";
import { eq } from "drizzle-orm";

import {
  computeDeltaPreview,
  serializeToggleState,
} from "../delta-preview";

const TEST_FIRM_ID = process.env.TEST_FIRM_ID;
const TEST_CLIENT_ID = process.env.TEST_CLIENT_ID;

describe("serializeToggleState", () => {
  it("produces a stable key regardless of insertion order", () => {
    expect(serializeToggleState({ a: true, b: false })).toBe(
      serializeToggleState({ b: false, a: true }),
    );
  });

  it("differs when the underlying state differs", () => {
    expect(serializeToggleState({ a: true })).not.toBe(
      serializeToggleState({ a: false }),
    );
  });

  it("returns a deterministic string for the empty state", () => {
    const empty = serializeToggleState({});
    expect(empty).toBe(serializeToggleState({}));
    expect(typeof empty).toBe("string");
  });
});

describe.skipIf(!TEST_FIRM_ID || !TEST_CLIENT_ID)(
  "computeDeltaPreview — integration",
  () => {
    it("returns a DeltaPreview shape with toggleId, delta, metricLabel", async () => {
      // Set up: a scenario with a toggle group + an "add account" change tagged
      // to that group. Toggling it on adds $100,000 to the portfolio; off
      // removes it. Expected delta: ~+100k at end-of-plan (with growth).
      const [scn] = await db
        .insert(scenarios)
        .values({
          clientId: TEST_CLIENT_ID!,
          name: `delta-preview-test-${Date.now()}`,
          isBaseCase: false,
        })
        .returning();

      try {
        const [grp] = await db
          .insert(scenarioToggleGroups)
          .values({
            scenarioId: scn.id,
            name: "Test toggle group",
            defaultOn: false,
            requiresGroupId: null,
            orderIndex: 0,
          })
          .returning();

        const newAccountId = randomUUID();
        await db.insert(scenarioChanges).values({
          scenarioId: scn.id,
          opType: "add",
          targetKind: "account",
          targetId: newAccountId,
          payload: {
            id: newAccountId,
            clientId: TEST_CLIENT_ID,
            scenarioId: scn.id,
            name: "Delta-preview test account",
            category: "taxable",
            subType: "brokerage",
            owner: "client",
            value: 100000,
            basis: 100000,
            growthRate: 0,
          },
          toggleGroupId: grp.id,
          orderIndex: 0,
        });

        const otherKey = serializeToggleState({});
        const result = await computeDeltaPreview(
          TEST_CLIENT_ID!,
          TEST_FIRM_ID!,
          scn.id,
          otherKey,
          grp.id,
          "endOfPlanPortfolio",
        );

        expect(result).toMatchObject({
          toggleId: grp.id,
          metricLabel: expect.stringContaining("portfolio"),
        });
        expect(typeof result.delta).toBe("number");
        // The added account is +100k portfolio when the group is on.
        // Allow some slack for growth / rounding.
        expect(result.delta).toBeGreaterThan(50000);
      } finally {
        // ON DELETE CASCADE on scenarios cleans up toggle_groups + changes.
        await db.delete(scenarios).where(eq(scenarios.id, scn.id));
      }
    });

    it("two calls with identical args reuse the cached result (same object identity)", async () => {
      const [scn] = await db
        .insert(scenarios)
        .values({
          clientId: TEST_CLIENT_ID!,
          name: `delta-preview-cache-${Date.now()}`,
          isBaseCase: false,
        })
        .returning();
      try {
        const [grp] = await db
          .insert(scenarioToggleGroups)
          .values({
            scenarioId: scn.id,
            name: "Cache test group",
            defaultOn: false,
            requiresGroupId: null,
            orderIndex: 0,
          })
          .returning();

        const otherKey = serializeToggleState({});
        const [a, b] = await Promise.all([
          computeDeltaPreview(
            TEST_CLIENT_ID!,
            TEST_FIRM_ID!,
            scn.id,
            otherKey,
            grp.id,
            "endOfPlanPortfolio",
          ),
          computeDeltaPreview(
            TEST_CLIENT_ID!,
            TEST_FIRM_ID!,
            scn.id,
            otherKey,
            grp.id,
            "endOfPlanPortfolio",
          ),
        ]);

        // React's `cache()` returns the same promise for identical args, so
        // resolved values share identity.
        expect(a).toBe(b);
      } finally {
        await db.delete(scenarios).where(eq(scenarios.id, scn.id));
      }
    });
  },
);
