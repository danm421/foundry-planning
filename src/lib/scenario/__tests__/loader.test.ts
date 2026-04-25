// src/lib/scenario/__tests__/loader.test.ts
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { loadEffectiveTree } from "../loader";
import { loadClientData } from "@/lib/projection/load-client-data";
import { db } from "@/db";
import { scenarios, scenarioChanges } from "@/db/schema";
import { and, eq } from "drizzle-orm";

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
