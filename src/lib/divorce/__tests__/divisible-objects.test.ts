// DB tests for loadDivisibleObjects — the base-scenario divisible-objects
// loader. Hits the real Neon dev branch and skips cleanly without a DB so it
// never adds to the no-delta failing set in CI. Each test owns its world via
// createMarriedFixture and tears it down in `finally` so an assertion failure
// can't leak rows.
import { describe, it, expect } from "vitest";
import { loadDivisibleObjects } from "../divisible-objects";
import { createMarriedFixture, destroyFixture, type MarriedFixture } from "./fixtures";

const HAS_DB = !!process.env.DATABASE_URL;
const d = HAS_DB ? describe : describe.skip;

d("loadDivisibleObjects", () => {
  it("maps ownership to sides + resolves scenario/principal ids", async () => {
    const f = await createMarriedFixture();
    try {
      const { objects, baseScenarioId, primaryFamilyMemberId, spouseFamilyMemberId } =
        await loadDivisibleObjects(f.clientId);
      expect(baseScenarioId).toBe(f.baseScenarioId);
      expect(primaryFamilyMemberId).toBe(f.primaryFmId);
      expect(spouseFamilyMemberId).toBe(f.spouseFmId);

      const byId = new Map(objects.map((o) => [o.id, o]));
      expect(byId.get(f.ids.primaryBrokerage)!.ownerSide).toBe("primary");
      expect(byId.get(f.ids.jointBrokerage)!.ownerSide).toBe("joint");
      expect(byId.get(f.ids.spouse401k)!.ownerSide).toBe("spouse");
      expect(byId.get(f.ids.spouse401k)!.rothValue).toBe(50_000);
      // 529 has no owner rows — side follows grantorFamilyMemberId (primary).
      expect(byId.get(f.ids.plan529)!.ownerSide).toBe("primary");
      expect(byId.get(f.ids.plan529)!.subtype).toBe("education_savings");

      // Values / basis round-trip as numbers (decimal → Number).
      const jb = byId.get(f.ids.jointBrokerage)!;
      expect(jb.value).toBe(600_000);
      expect(jb.basis).toBe(200_000);
      expect(jb.kind).toBe("account");
      expect(jb.subtype).toBe("taxable");
    } finally {
      await destroyFixture(f);
    }
  });

  it("marks entity-owned accounts and nests them under the entity", async () => {
    const f = await createMarriedFixture();
    try {
      const { objects } = await loadDivisibleObjects(f.clientId);
      const byId = new Map(objects.map((o) => [o.id, o]));

      const trustAccount = byId.get(f.ids.trustAccount)!;
      expect(trustAccount.entityOwnedById).toBe(f.ids.trust);
      expect(trustAccount.ownerSide).toBe("entity");

      const trust = byId.get(f.ids.trust)!;
      expect(trust.kind).toBe("entity");
      expect(trust.childIds).toContain(f.ids.trustAccount);
      expect(trust.entityOwnedById).toBeNull();
      // entity value = entities.value (0) + Σ owned-account values (300k).
      expect(trust.value).toBe(300_000);
      // Side from the entity_owners fm row (primary), subtype from trustSubType.
      expect(trust.ownerSide).toBe("primary");
      expect(trust.subtype).toBe("irrevocable");
    } finally {
      await destroyFixture(f);
    }
  });

  it("excludes the client + spouse family_members rows, includes the child", async () => {
    const f = await createMarriedFixture();
    try {
      const { objects } = await loadDivisibleObjects(f.clientId);
      const byId = new Map(objects.map((o) => [o.id, o]));

      // Principals are not divisible objects — they define the two sides.
      expect(byId.has(f.primaryFmId)).toBe(false);
      expect(byId.has(f.spouseFmId)).toBe(false);

      const child = byId.get(f.childFmId)!;
      expect(child).toBeDefined();
      expect(child.kind).toBe("family_member");
    } finally {
      await destroyFixture(f);
    }
  });

  it("liability ownerSide joint via liability_owners; income owner enum maps", async () => {
    const f = await createMarriedFixture();
    try {
      const { objects } = await loadDivisibleObjects(f.clientId);
      const byId = new Map(objects.map((o) => [o.id, o]));

      const mortgage = byId.get(f.ids.jointMortgage)!;
      expect(mortgage.kind).toBe("liability");
      expect(mortgage.ownerSide).toBe("joint");
      expect(mortgage.value).toBe(300_000);

      expect(byId.get(f.ids.spouseSalary)!.ownerSide).toBe("spouse");
      expect(byId.get(f.ids.spouseSalary)!.annualAmount).toBe(120_000);
      expect(byId.get(f.ids.primarySalary)!.ownerSide).toBe("primary");
      // Living expense has no person/entity/account owner → none.
      expect(byId.get(f.ids.livingExpense)!.ownerSide).toBe("none");
      expect(byId.get(f.ids.livingExpense)!.annualAmount).toBe(90_000);
    } finally {
      await destroyFixture(f);
    }
  });

  it("noSpouse override builds a valid single-filer client", async () => {
    let f: MarriedFixture | null = null;
    try {
      f = await createMarriedFixture({ filingStatus: "single", noSpouse: true });
      const { objects, spouseFamilyMemberId } = await loadDivisibleObjects(f.clientId);
      expect(spouseFamilyMemberId).toBeNull();
      const byId = new Map(objects.map((o) => [o.id, o]));
      expect(byId.get(f.ids.primaryBrokerage)!.ownerSide).toBe("primary");
    } finally {
      if (f) await destroyFixture(f);
    }
  });
});
