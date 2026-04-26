// src/lib/scenario/__tests__/snapshot.test.ts
//
// Live-DB tests gated on TEST_FIRM_ID + TEST_CLIENT_ID env vars (same pattern
// as `loader.test.ts`). When the env vars are missing, the suites skip cleanly
// rather than failing — keeps `npm test` green in CI without DB access.

import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";

import { createSnapshot, readSnapshot } from "../snapshot";
import { loadEffectiveTreeForRef } from "../loader";
import { db } from "@/db";
import {
  scenarioChanges,
  scenarioSnapshots,
  scenarios,
} from "@/db/schema";

const TEST_FIRM_ID = process.env.TEST_FIRM_ID;
const TEST_CLIENT_ID = process.env.TEST_CLIENT_ID;
const skip = !TEST_FIRM_ID || !TEST_CLIENT_ID;

// Clerk user ids look like `user_2qXyZ...`. The original 0050 schema declared
// `frozen_by_user_id` as `uuid` which would reject these; 0053 fixed it to
// `text`. Use a Clerk-shaped fixture so the test exercises the post-fix shape.
function clerkUserId(): string {
  return `user_test_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

describe.skipIf(skip)("createSnapshot + readSnapshot — round-trip", () => {
  it("writes a row with all fields populated and reads it back identically", async () => {
    // Set up a non-base scenario with one change row so the snapshot has
    // non-trivial raw_changes_right + a distinct effective tree.
    const [scn] = await db
      .insert(scenarios)
      .values({
        clientId: TEST_CLIENT_ID!,
        name: "snapshot-test-scn-roundtrip",
        isBaseCase: false,
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
        name: "Snapshot test account",
        category: "retirement",
        subType: "roth_ira",
        owner: "client",
        value: 50000,
        basis: 0,
      },
      toggleGroupId: null,
      orderIndex: 0,
    });

    const userId = clerkUserId();

    let snapshotId: string | undefined;
    try {
      const created = await createSnapshot({
        clientId: TEST_CLIENT_ID!,
        firmId: TEST_FIRM_ID!,
        leftRef: { kind: "scenario", id: "base", toggleState: {} },
        rightRef: { kind: "scenario", id: scn.id, toggleState: {} },
        name: "Round-trip test snapshot",
        description: "round-trip description",
        sourceKind: "manual",
        userId,
      });
      snapshotId = created.id;

      // Confirm fields land on the row as inserted.
      expect(created.clientId).toBe(TEST_CLIENT_ID);
      expect(created.name).toBe("Round-trip test snapshot");
      expect(created.description).toBe("round-trip description");
      expect(created.leftScenarioId).toBeNull(); // left = base → null
      expect(created.rightScenarioId).toBe(scn.id);
      expect(created.sourceKind).toBe("manual");
      expect(created.frozenByUserId).toBe(userId);
      expect(created.frozenAt).toBeInstanceOf(Date);

      // Effective tree on the right must include our scenario-only account.
      const rightTree = created.effectiveTreeRight as {
        accounts: Array<{ id: string; name: string }>;
      };
      const found = rightTree.accounts.find((a) => a.id === newAccountId);
      expect(found).toBeDefined();
      expect(found!.name).toBe("Snapshot test account");

      // raw_changes_right should contain our one inserted change.
      const rawChanges = created.rawChangesRight as Array<{
        targetId: string;
        opType: string;
      }>;
      expect(rawChanges).toHaveLength(1);
      expect(rawChanges[0].targetId).toBe(newAccountId);
      expect(rawChanges[0].opType).toBe("add");

      // raw_toggle_groups_right is empty (no groups created).
      expect(created.rawToggleGroupsRight).toEqual([]);

      // toggle_state matches the right ref's toggleState ({}).
      expect(created.toggleState).toEqual({});

      // readSnapshot returns the same row.
      const read = await readSnapshot(created.id);
      expect(read.id).toBe(created.id);
      expect(read.clientId).toBe(created.clientId);
      expect(read.name).toBe(created.name);
      expect(read.description).toBe(created.description);
      expect(read.leftScenarioId).toBe(created.leftScenarioId);
      expect(read.rightScenarioId).toBe(created.rightScenarioId);
      expect(read.effectiveTreeLeft).toEqual(created.effectiveTreeLeft);
      expect(read.effectiveTreeRight).toEqual(created.effectiveTreeRight);
      expect(read.toggleState).toEqual(created.toggleState);
      expect(read.rawChangesRight).toEqual(created.rawChangesRight);
      expect(read.rawToggleGroupsRight).toEqual(created.rawToggleGroupsRight);
      expect(read.sourceKind).toBe(created.sourceKind);
      expect(read.frozenByUserId).toBe(created.frozenByUserId);

      // The frozen left tree must equal what loadEffectiveTreeForRef returns
      // for the base ref — i.e., the snapshot really is a faithful capture.
      const { effectiveTree: liveLeft } = await loadEffectiveTreeForRef(
        TEST_CLIENT_ID!,
        TEST_FIRM_ID!,
        { kind: "scenario", id: "base", toggleState: {} },
      );
      expect(read.effectiveTreeLeft).toEqual(liveLeft);
    } finally {
      if (snapshotId) {
        await db.delete(scenarioSnapshots).where(eq(scenarioSnapshots.id, snapshotId));
      }
      // ON DELETE CASCADE on scenario_changes.scenario_id cleans up the change row.
      await db.delete(scenarios).where(eq(scenarios.id, scn.id));
    }
  });

  it("supports the degenerate base-on-base case (no scenario ids, empty raw arrays)", async () => {
    const userId = clerkUserId();
    let snapshotId: string | undefined;

    try {
      const created = await createSnapshot({
        clientId: TEST_CLIENT_ID!,
        firmId: TEST_FIRM_ID!,
        leftRef: { kind: "scenario", id: "base", toggleState: {} },
        rightRef: { kind: "scenario", id: "base", toggleState: {} },
        name: "Base-on-base snapshot",
        sourceKind: "manual",
        userId,
      });
      snapshotId = created.id;

      expect(created.leftScenarioId).toBeNull();
      expect(created.rightScenarioId).toBeNull();
      expect(created.rawChangesRight).toEqual([]);
      expect(created.rawToggleGroupsRight).toEqual([]);
      expect(created.toggleState).toEqual({});
      // Both effective trees are the base tree; equal to each other.
      expect(created.effectiveTreeLeft).toEqual(created.effectiveTreeRight);
      // description is optional and defaults to null.
      expect(created.description).toBeNull();

      const read = await readSnapshot(created.id);
      expect(read).toEqual(created);
    } finally {
      if (snapshotId) {
        await db.delete(scenarioSnapshots).where(eq(scenarioSnapshots.id, snapshotId));
      }
    }
  });

  it("survives deletion of the source scenario — frozen trees stay intact, rightScenarioId becomes an orphan id", async () => {
    // No FK on scenario_snapshots.right_scenario_id (verified via 0050: the
    // only FK is client_id → clients with ON DELETE CASCADE; the scenario id
    // columns are bare uuids by design, per spec §3.1 "snapshots survive
    // scenario deletion"). So after deleting the scenario, the row stays and
    // the column keeps the now-orphan uuid.
    const [scn] = await db
      .insert(scenarios)
      .values({
        clientId: TEST_CLIENT_ID!,
        name: "snapshot-test-scn-survives-delete",
        isBaseCase: false,
      })
      .returning();

    const userId = clerkUserId();
    let snapshotId: string | undefined;

    try {
      const created = await createSnapshot({
        clientId: TEST_CLIENT_ID!,
        firmId: TEST_FIRM_ID!,
        leftRef: { kind: "scenario", id: "base", toggleState: {} },
        rightRef: { kind: "scenario", id: scn.id, toggleState: { foo: true } },
        name: "Survives-delete snapshot",
        sourceKind: "manual",
        userId,
      });
      snapshotId = created.id;
      const orphanScenarioId = scn.id;

      // Delete the source scenario. Cascade clears scenario_changes /
      // scenario_toggle_groups for it, but should NOT touch the snapshot.
      await db.delete(scenarios).where(eq(scenarios.id, scn.id));

      // Confirm the scenario really is gone.
      const remaining = await db
        .select()
        .from(scenarios)
        .where(eq(scenarios.id, orphanScenarioId));
      expect(remaining).toHaveLength(0);

      // Snapshot still readable; frozen trees still match what was captured.
      const read = await readSnapshot(created.id);
      expect(read.id).toBe(created.id);
      expect(read.effectiveTreeLeft).toEqual(created.effectiveTreeLeft);
      expect(read.effectiveTreeRight).toEqual(created.effectiveTreeRight);
      expect(read.toggleState).toEqual({ foo: true });
      // rightScenarioId stays as the now-orphan uuid — no FK to null it out.
      expect(read.rightScenarioId).toBe(orphanScenarioId);
    } finally {
      if (snapshotId) {
        await db.delete(scenarioSnapshots).where(eq(scenarioSnapshots.id, snapshotId));
      }
      // Defensive: if the test failed before the scenario delete, clean up.
      await db
        .delete(scenarios)
        .where(and(eq(scenarios.id, scn.id), eq(scenarios.clientId, TEST_CLIENT_ID!)));
    }
  });

  it("readSnapshot throws for an unknown id", async () => {
    await expect(readSnapshot(randomUUID())).rejects.toThrow(/not found/);
  });
});
