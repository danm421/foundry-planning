// src/lib/scenario/__tests__/loader.test.ts
import { describe, it, expect } from "vitest";
import { loadEffectiveTree } from "../loader";
import { loadClientData } from "@/lib/projection/load-client-data";
import { db } from "@/db";
import { scenarios } from "@/db/schema";
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
