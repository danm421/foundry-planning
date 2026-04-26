// src/lib/scenario/__tests__/snapshot-banner-data.test.ts
//
// Live-DB tests gated on TEST_FIRM_ID + TEST_CLIENT_ID — same pattern as
// loader.test.ts / snapshot.test.ts. When env vars are missing, suites skip.

import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";

import { loadSnapshotBannerData } from "../snapshot-banner-data";
import { db } from "@/db";
import { scenarioSnapshots } from "@/db/schema";

const TEST_FIRM_ID = process.env.TEST_FIRM_ID;
const TEST_CLIENT_ID = process.env.TEST_CLIENT_ID;
const skip = !TEST_FIRM_ID || !TEST_CLIENT_ID;

function clerkUserId(): string {
  return `user_test_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

async function seedSnapshot(opts: {
  clientId: string;
  rawToggleGroupsRight?: unknown;
}): Promise<string> {
  const [row] = await db
    .insert(scenarioSnapshots)
    .values({
      clientId: opts.clientId,
      name: "banner-data-test",
      description: null,
      leftScenarioId: null,
      rightScenarioId: null,
      effectiveTreeLeft: { __marker: "left" },
      effectiveTreeRight: { __marker: "right" },
      toggleState: {},
      rawChangesRight: [],
      rawToggleGroupsRight: opts.rawToggleGroupsRight ?? [],
      frozenByUserId: clerkUserId(),
      sourceKind: "manual",
    })
    .returning({ id: scenarioSnapshots.id });
  return row.id;
}

describe.skipIf(skip)("loadSnapshotBannerData", () => {
  it("returns null for a non-snapshot ref", async () => {
    const result = await loadSnapshotBannerData(
      TEST_CLIENT_ID!,
      TEST_FIRM_ID!,
      { kind: "scenario", id: "base", toggleState: {} },
    );
    expect(result).toBeNull();
  });

  it("returns name + frozenAt + frozenByUserId + rawToggleGroupsRight for a snapshot ref", async () => {
    const groups = [
      {
        id: randomUUID(),
        scenarioId: randomUUID(),
        name: "Roth conversions",
        defaultOn: false,
        requiresGroupId: null,
        orderIndex: 0,
      },
    ];
    const snapId = await seedSnapshot({
      clientId: TEST_CLIENT_ID!,
      rawToggleGroupsRight: groups,
    });

    try {
      const result = await loadSnapshotBannerData(
        TEST_CLIENT_ID!,
        TEST_FIRM_ID!,
        { kind: "snapshot", id: snapId, side: "right" },
      );
      expect(result).not.toBeNull();
      expect(result!.id).toBe(snapId);
      expect(result!.name).toBe("banner-data-test");
      expect(result!.frozenAt).toBeInstanceOf(Date);
      expect(result!.frozenByUserId).toMatch(/^user_test_/);
      expect(result!.rawToggleGroupsRight).toEqual(groups);
    } finally {
      await db
        .delete(scenarioSnapshots)
        .where(eq(scenarioSnapshots.id, snapId));
    }
  });

  it("throws when the snapshot id does not exist / belongs to another client", async () => {
    await expect(
      loadSnapshotBannerData(TEST_CLIENT_ID!, TEST_FIRM_ID!, {
        kind: "snapshot",
        id: randomUUID(),
        side: "right",
      }),
    ).rejects.toThrow(/Snapshot .* not found/);
  });
});
