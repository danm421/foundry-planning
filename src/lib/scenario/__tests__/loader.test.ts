// src/lib/scenario/__tests__/loader.test.ts
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { loadEffectiveTree, loadEffectiveTreeForRef } from "../loader";
import { loadClientData } from "@/lib/projection/load-client-data";
import { db } from "@/db";
import { scenarios, scenarioChanges, scenarioSnapshots, externalBeneficiaries } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import type { ClientData } from "@/engine/types";

const TEST_FIRM_ID = process.env.TEST_FIRM_ID;
const TEST_CLIENT_ID = process.env.TEST_CLIENT_ID;

describe.skipIf(!TEST_FIRM_ID || !TEST_CLIENT_ID)(
  "loadEffectiveTree — base-case fast path",
  () => {
    it("returns the same data as loadClientData when scenario=base and toggleState={}", async () => {
      const [base] = await db
        .select()
        .from(scenarios)
        .where(and(eq(scenarios.clientId, TEST_CLIENT_ID!), eq(scenarios.isBaseCase, true)));

      const [direct, viaLoader] = await Promise.all([
        loadClientData(TEST_CLIENT_ID!, TEST_FIRM_ID!),
        loadEffectiveTree(TEST_CLIENT_ID!, TEST_FIRM_ID!, base.id, {}),
      ]);

      expect(viaLoader.effectiveTree).toEqual(direct);
      expect(viaLoader.warnings).toEqual([]);
    });
  },
);

describe.skipIf(!TEST_FIRM_ID || !TEST_CLIENT_ID)(
  "loadEffectiveTree — with scenario changes",
  () => {
    it("applies an account-add change to the effective tree", async () => {
      // Setup: create a non-base scenario for the test client
      const [scn] = await db
        .insert(scenarios)
        .values({ clientId: TEST_CLIENT_ID!, name: "loader-test-scn", isBaseCase: false })
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
          name: "Test scenario account",
          category: "retirement",
          subType: "roth_ira",
          owner: "client",
          value: 100000,
          basis: 0,
        },
        toggleGroupId: null,
        orderIndex: 0,
      });

      try {
        const result = await loadEffectiveTree(
          TEST_CLIENT_ID!, TEST_FIRM_ID!, scn.id, {},
        );
        const found = result.effectiveTree.accounts.find((a) => a.id === newAccountId);
        expect(found).toBeDefined();
        expect(found!.name).toBe("Test scenario account");
      } finally {
        // Cleanup: ON DELETE CASCADE on scenario_changes.scenario_id cleans up the change row
        await db.delete(scenarios).where(eq(scenarios.id, scn.id));
      }
    });
  },
);

describe.skipIf(!TEST_FIRM_ID || !TEST_CLIENT_ID)(
  "loadEffectiveTreeForRef",
  () => {
    /**
     * Insert a minimal snapshot row with two distinct frozen trees so we can
     * assert that `side: "left" | "right"` selects the right one.
     */
    async function seedSnapshot({
      clientId,
      leftTree,
      rightTree,
    }: {
      clientId: string;
      leftTree: unknown;
      rightTree: unknown;
    }): Promise<string> {
      const [row] = await db
        .insert(scenarioSnapshots)
        .values({
          clientId,
          name: "loader-test-snap",
          description: null,
          leftScenarioId: null,
          rightScenarioId: null,
          effectiveTreeLeft: leftTree,
          effectiveTreeRight: rightTree,
          toggleState: {},
          rawChangesRight: [],
          rawToggleGroupsRight: [],
          // frozen_by_user_id is uuid notNull — use a random uuid for test seeding
          frozenByUserId: randomUUID(),
          sourceKind: "manual",
        })
        .returning({ id: scenarioSnapshots.id });
      return row.id;
    }

    it("scenario-ref delegates to loadEffectiveTree (base case)", async () => {
      const [base] = await db
        .select()
        .from(scenarios)
        .where(
          and(eq(scenarios.clientId, TEST_CLIENT_ID!), eq(scenarios.isBaseCase, true)),
        );

      const [viaRef, viaDirect] = await Promise.all([
        loadEffectiveTreeForRef(TEST_CLIENT_ID!, TEST_FIRM_ID!, {
          kind: "scenario",
          id: base.id,
          toggleState: {},
        }),
        loadEffectiveTree(TEST_CLIENT_ID!, TEST_FIRM_ID!, base.id, {}),
      ]);

      expect(viaRef.effectiveTree).toEqual(viaDirect.effectiveTree);
      expect(viaRef.warnings).toEqual(viaDirect.warnings);
    });

    it("snapshot-ref returns the frozen left tree verbatim", async () => {
      const leftTree = { __marker: "left-tree" } as unknown as ClientData;
      const rightTree = { __marker: "right-tree" } as unknown as ClientData;
      const snapId = await seedSnapshot({
        clientId: TEST_CLIENT_ID!,
        leftTree,
        rightTree,
      });

      try {
        const result = await loadEffectiveTreeForRef(TEST_CLIENT_ID!, TEST_FIRM_ID!, {
          kind: "snapshot",
          id: snapId,
          side: "left",
        });
        expect(result.effectiveTree).toEqual(leftTree);
        expect(result.warnings).toEqual([]);
      } finally {
        await db.delete(scenarioSnapshots).where(eq(scenarioSnapshots.id, snapId));
      }
    });

    it("snapshot-ref returns the frozen right tree verbatim", async () => {
      const leftTree = { __marker: "left-tree" } as unknown as ClientData;
      const rightTree = { __marker: "right-tree" } as unknown as ClientData;
      const snapId = await seedSnapshot({
        clientId: TEST_CLIENT_ID!,
        leftTree,
        rightTree,
      });

      try {
        const result = await loadEffectiveTreeForRef(TEST_CLIENT_ID!, TEST_FIRM_ID!, {
          kind: "snapshot",
          id: snapId,
          side: "right",
        });
        expect(result.effectiveTree).toEqual(rightTree);
        expect(result.warnings).toEqual([]);
      } finally {
        await db.delete(scenarioSnapshots).where(eq(scenarioSnapshots.id, snapId));
      }
    });

    it("snapshot-ref throws when the snapshot id is unknown / cross-firm", async () => {
      // Random uuid that isn't in the table — covers both "not found" and the
      // cross-firm case (a real id from another firm's client wouldn't satisfy
      // the firmId join either).
      await expect(
        loadEffectiveTreeForRef(TEST_CLIENT_ID!, TEST_FIRM_ID!, {
          kind: "snapshot",
          id: randomUUID(),
          side: "left",
        }),
      ).rejects.toThrow(/Snapshot .* not found/);
    });
  },
);

describe.skipIf(!TEST_FIRM_ID || !TEST_CLIENT_ID)(
  "loadEffectiveTree — external_beneficiaries threaded through",
  () => {
    it("loads external_beneficiaries onto the effective tree", async () => {
      // Seed two rows: one charity (public), one individual
      const [charity, individual] = await db
        .insert(externalBeneficiaries)
        .values([
          {
            clientId: TEST_CLIENT_ID!,
            name: "Stanford University",
            kind: "charity" as const,
            charityType: "public" as const,
          },
          {
            clientId: TEST_CLIENT_ID!,
            name: "Jane Doe",
            kind: "individual" as const,
            charityType: "public" as const, // charityType is notNull; default for individuals
          },
        ])
        .returning();

      try {
        const { effectiveTree } = await loadEffectiveTree(
          TEST_CLIENT_ID!,
          TEST_FIRM_ID!,
          "base",
          {},
        );

        const extBens = effectiveTree.externalBeneficiaries ?? [];
        const charityRow = extBens.find((e) => e.id === charity.id);
        const individualRow = extBens.find((e) => e.id === individual.id);

        expect(charityRow).toBeDefined();
        expect(charityRow!.name).toBe("Stanford University");
        expect(charityRow!.kind).toBe("charity");
        expect(charityRow!.charityType).toBe("public");

        expect(individualRow).toBeDefined();
        expect(individualRow!.name).toBe("Jane Doe");
        expect(individualRow!.kind).toBe("individual");
      } finally {
        await db
          .delete(externalBeneficiaries)
          .where(
            inArray(externalBeneficiaries.id, [charity.id, individual.id]),
          );
      }
    });
  },
);
