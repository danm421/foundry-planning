// Drives the REAL paths an inherited IRA reaches the engine through:
//   base:     write-core insert → loadEffectiveTree("base") → runProjection
//   scenario: form body helper → applyEntityEdit on a BASE IRA → loadEffectiveTree(scenario)
// Includes a string-typed edit (what a non-form writer could send) to pin the
// NUMERIC_FIELDS_BY_KIND coercion — a hand-shaped numeric payload would be vacuous.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, scenarios } from "@/db/schema";
import { runProjection } from "@/engine";
import { controllingFamilyMember } from "@/engine/ownership";
import type { Account } from "@/engine/types";
import { inheritedIraBodyFields } from "@/lib/accounts/inherited-ira";
import { applyEntityEdit } from "../changes-writer";
import { loadEffectiveTree } from "../loader";

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: "user_test_inherited_load", orgRole: "org:admin", orgId: "org_3CitTEIe8PJa1BVYw7LnEjkiP9r" }),
}));

import { createAccountForClient } from "@/lib/clients/accounts-writes";

const COOPER_CLIENT_ID = "877a9532-f8ea-49b0-9db7-aadd64fab82a";
const COOPER_FIRM_ID = "org_3CitTEIe8PJa1BVYw7LnEjkiP9r";
const COOPER_FM_ID = "7f875f15-50f6-4ef2-8f18-8a0b1f8b3997";
const HAS_DB = !!process.env.DATABASE_URL;

function hasInheritedRmd(tree: Parameters<typeof runProjection>[0], accountId: string): boolean {
  const first = runProjection(tree).find((y) => y.year === tree.planSettings.planStartYear)!;
  return (first.accountLedgers[accountId]?.entries ?? []).some((e) => e.label.startsWith("Inherited IRA RMD"));
}

describe.skipIf(!HAS_DB)("inherited IRA — load paths", () => {
  let scenarioId: string;
  const createdAccountIds: string[] = [];

  beforeEach(async () => {
    const [row] = await db.insert(scenarios)
      .values({ clientId: COOPER_CLIENT_ID, name: `inh-ira-${randomUUID().slice(0, 8)}`, isBaseCase: false })
      .returning();
    scenarioId = row.id;
  });

  afterEach(async () => {
    await db.delete(scenarios).where(eq(scenarios.id, scenarioId));
    for (const id of createdAccountIds.splice(0)) await db.delete(accounts).where(eq(accounts.id, id));
  });

  it("base: a saved inherited IRA loads with numeric fields and takes the inherited RMD", async () => {
    const res = await createAccountForClient({
      clientId: COOPER_CLIENT_ID, firmId: COOPER_FIRM_ID, actorId: "user_test_inherited_load",
      input: {
        name: "Inherited IRA (load test)", category: "retirement", subType: "traditional_ira", value: "400000",
        owners: [{ kind: "family_member", familyMemberId: COOPER_FM_ID, percent: 1 }],
        inheritedDeathYear: 2022, inheritedOwnerBirthYear: 1945,
      },
    });
    if (!res.ok) throw new Error(res.error);
    createdAccountIds.push(res.data.id);

    const { effectiveTree } = await loadEffectiveTree(COOPER_CLIENT_ID, COOPER_FIRM_ID, "base", {});
    const acct = effectiveTree.accounts.find((a: Account) => a.id === res.data.id)!;
    expect(acct.inheritedDeathYear).toBe(2022);
    expect(acct.inheritedOwnerBirthYear).toBe(1945);
    expect(hasInheritedRmd(effectiveTree, res.data.id)).toBe(true);
  });

  it("scenario: editing a base IRA through the form's body helper makes it inherited in that scenario only", async () => {
    const { effectiveTree: base } = await loadEffectiveTree(COOPER_CLIENT_ID, COOPER_FIRM_ID, "base", {});
    const ira = base.accounts.find(
      (a: Account) => a.category === "retirement" && a.subType === "traditional_ira" && controllingFamilyMember(a) != null && a.value > 0,
    );
    if (!ira) throw new Error("fixture: Cooper Sample has no family-owned funded Traditional IRA");

    await applyEntityEdit({
      scenarioId, firmId: COOPER_FIRM_ID, targetKind: "account", targetId: ira.id,
      // `InheritedIraBody` has no index signature (unlike the other
      // `desiredFields` helpers in this file's sibling suites, which spread a
      // `Record<string, unknown>` into their return literal); `applyEntityEdit`
      // wants `Record<string, unknown>`, so the cast is type-level only.
      desiredFields: inheritedIraBodyFields(
        { inherited: true, deathYear: "2022", ownerBirthYear: "1945", heirDisabled: false },
        "retirement", "traditional_ira",
      ) as unknown as Record<string, unknown>,
    });

    const { effectiveTree } = await loadEffectiveTree(COOPER_CLIENT_ID, COOPER_FIRM_ID, scenarioId, {});
    const edited = effectiveTree.accounts.find((a: Account) => a.id === ira.id)!;
    expect(edited.inheritedDeathYear).toBe(2022);
    expect(hasInheritedRmd(effectiveTree, ira.id)).toBe(true);
    expect(hasInheritedRmd(base, ira.id)).toBe(false);
  });

  it("scenario: string-typed years are coerced to numbers before the engine sees them", async () => {
    const { effectiveTree: base } = await loadEffectiveTree(COOPER_CLIENT_ID, COOPER_FIRM_ID, "base", {});
    const ira = base.accounts.find(
      (a: Account) => a.category === "retirement" && a.subType === "traditional_ira" && controllingFamilyMember(a) != null && a.value > 0,
    )!;
    await applyEntityEdit({
      scenarioId, firmId: COOPER_FIRM_ID, targetKind: "account", targetId: ira.id,
      desiredFields: { inheritedDeathYear: "2022", inheritedOwnerBirthYear: "1945" },
    });
    const { effectiveTree } = await loadEffectiveTree(COOPER_CLIENT_ID, COOPER_FIRM_ID, scenarioId, {});
    const edited = effectiveTree.accounts.find((a: Account) => a.id === ira.id)!;
    expect(typeof edited.inheritedDeathYear).toBe("number");
    expect(typeof edited.inheritedOwnerBirthYear).toBe("number");
    expect(hasInheritedRmd(effectiveTree, ira.id)).toBe(true);
  });
});
