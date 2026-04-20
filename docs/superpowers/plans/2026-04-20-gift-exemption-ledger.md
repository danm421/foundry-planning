# Gift Exemption Ledger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a year-indexed `gifts` table + pure-function ledger helpers that derive per-grantor lifetime-exemption usage from raw gift facts, and wire it through API, UI, and engine input (data only).

**Architecture:** One new table `gifts` with a polymorphic recipient (entity / family_member / external_beneficiary) and a `use_crummey_powers` toggle. A new column `gift_annual_exclusion` on `tax_year_parameters` seeded with 2024–2026 IRS values; unseeded years get inflation-projected by a helper. Three pure helpers (tax-treatment, annual-exclusion resolver, per-grantor ledger). Zod-validated CRUD routes. UI adds a Gifts section + updates trust card footer. Engine input carries gifts through; no engine rule reads them yet.

**Tech Stack:** Next.js App Router, Drizzle ORM (PostgreSQL), Zod, Vitest, Tailwind/React.

**Spec:** [docs/superpowers/specs/2026-04-20-gift-exemption-ledger-design.md](../specs/2026-04-20-gift-exemption-ledger-design.md)

---

## File Structure

Created files:

- `src/lib/gifts/compute-tax-treatment.ts` — `computeGiftTaxTreatment` helper.
- `src/lib/gifts/__tests__/compute-tax-treatment.test.ts`
- `src/lib/gifts/resolve-annual-exclusion.ts` — `resolveAnnualExclusion` helper.
- `src/lib/gifts/__tests__/resolve-annual-exclusion.test.ts`
- `src/lib/gifts/compute-ledger.ts` — `computeExemptionLedger` helper.
- `src/lib/gifts/__tests__/compute-ledger.test.ts`
- `src/lib/schemas/gifts.ts` — Zod schemas.
- `src/lib/schemas/__tests__/gifts.test.ts`
- `src/app/api/clients/[id]/gifts/route.ts` — GET, POST.
- `src/app/api/clients/[id]/gifts/[giftId]/route.ts` — PATCH, DELETE.
- `src/db/migrations/0040_gifts.sql` — new table + new column + seeded backfill.
- `src/__tests__/gifts-tenant-isolation.test.ts` — live-DB cross-firm cases.

Modified files:

- `src/db/schema.ts` — new `gifts` table, `gift_annual_exclusion` column on `tax_year_parameters`, relations.
- `src/engine/types.ts` — `Gift` type and `ClientData.gifts`.
- `src/app/api/clients/[id]/projection-data/route.ts` — load gifts and include on payload.
- `src/components/family-view.tsx` — Gifts section (table + inline form), trust-card footer rendering, EntityDialog label change on `exemption_consumed`.
- `src/app/(app)/clients/[id]/client-data/family/page.tsx` — load gifts + pass to `FamilyView`.
- `docs/FUTURE_WORK.md` — deferred items.

---

### Task 1: `computeGiftTaxTreatment` helper

**Files:**
- Create: `src/lib/gifts/compute-tax-treatment.ts`
- Test: `src/lib/gifts/__tests__/compute-tax-treatment.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/gifts/__tests__/compute-tax-treatment.test.ts
import { describe, it, expect } from "vitest";
import {
  computeGiftTaxTreatment,
  type GiftInput,
  type GiftContext,
} from "../compute-tax-treatment";

const giftTo = (partial: Partial<GiftInput>): GiftInput => ({
  amount: 100,
  useCrummeyPowers: false,
  recipientEntityId: null,
  recipientFamilyMemberId: null,
  recipientExternalBeneficiaryId: null,
  ...partial,
});

describe("computeGiftTaxTreatment", () => {
  it("irrevocable trust, Crummey off → full lifetime", () => {
    const r = computeGiftTaxTreatment(
      giftTo({ amount: 2_400_000, recipientEntityId: "t1" }),
      {
        entity: { isIrrevocable: true, entityType: "trust" },
        annualExclusionAmount: 19_000,
        crummeyBeneficiaryCount: 0,
      },
    );
    expect(r).toEqual({
      lifetimeUsed: 2_400_000,
      annualExcluded: 0,
      charitableExcluded: 0,
    });
  });

  it("irrevocable trust, Crummey on, 3 beneficiaries, gift within exclusion → fully excluded", () => {
    const r = computeGiftTaxTreatment(
      giftTo({
        amount: 50_000,
        useCrummeyPowers: true,
        recipientEntityId: "t1",
      }),
      {
        entity: { isIrrevocable: true, entityType: "trust" },
        annualExclusionAmount: 19_000,
        crummeyBeneficiaryCount: 3,
      },
    );
    expect(r).toEqual({
      lifetimeUsed: 0,
      annualExcluded: 50_000,
      charitableExcluded: 0,
    });
  });

  it("irrevocable trust, Crummey on, 3 beneficiaries, gift over 3 × exclusion → remainder to lifetime", () => {
    const r = computeGiftTaxTreatment(
      giftTo({
        amount: 100_000,
        useCrummeyPowers: true,
        recipientEntityId: "t1",
      }),
      {
        entity: { isIrrevocable: true, entityType: "trust" },
        annualExclusionAmount: 19_000,
        crummeyBeneficiaryCount: 3,
      },
    );
    // 3 × 19_000 = 57_000 annual; 43_000 lifetime
    expect(r).toEqual({
      lifetimeUsed: 43_000,
      annualExcluded: 57_000,
      charitableExcluded: 0,
    });
  });

  it("family member, within single exclusion → fully annual-excluded", () => {
    const r = computeGiftTaxTreatment(
      giftTo({ amount: 10_000, recipientFamilyMemberId: "fm1" }),
      {
        annualExclusionAmount: 19_000,
        crummeyBeneficiaryCount: 0,
      },
    );
    expect(r).toEqual({
      lifetimeUsed: 0,
      annualExcluded: 10_000,
      charitableExcluded: 0,
    });
  });

  it("family member, over exclusion → remainder lifetime", () => {
    const r = computeGiftTaxTreatment(
      giftTo({ amount: 25_000, recipientFamilyMemberId: "fm1" }),
      {
        annualExclusionAmount: 19_000,
        crummeyBeneficiaryCount: 0,
      },
    );
    expect(r).toEqual({
      lifetimeUsed: 6_000,
      annualExcluded: 19_000,
      charitableExcluded: 0,
    });
  });

  it("external individual → same rule as family member", () => {
    const r = computeGiftTaxTreatment(
      giftTo({ amount: 25_000, recipientExternalBeneficiaryId: "ext1" }),
      {
        external: { kind: "individual" },
        annualExclusionAmount: 19_000,
        crummeyBeneficiaryCount: 0,
      },
    );
    expect(r).toEqual({
      lifetimeUsed: 6_000,
      annualExcluded: 19_000,
      charitableExcluded: 0,
    });
  });

  it("external charity → all charitable-excluded", () => {
    const r = computeGiftTaxTreatment(
      giftTo({ amount: 1_000_000, recipientExternalBeneficiaryId: "ext1" }),
      {
        external: { kind: "charity" },
        annualExclusionAmount: 19_000,
        crummeyBeneficiaryCount: 0,
      },
    );
    expect(r).toEqual({
      lifetimeUsed: 0,
      annualExcluded: 0,
      charitableExcluded: 1_000_000,
    });
  });

  it("revocable trust → throws", () => {
    expect(() =>
      computeGiftTaxTreatment(
        giftTo({ amount: 100_000, recipientEntityId: "t1" }),
        {
          entity: { isIrrevocable: false, entityType: "trust" },
          annualExclusionAmount: 19_000,
          crummeyBeneficiaryCount: 0,
        },
      ),
    ).toThrow(/revocable/i);
  });

  it("non-trust entity → throws", () => {
    expect(() =>
      computeGiftTaxTreatment(
        giftTo({ amount: 100_000, recipientEntityId: "e1" }),
        {
          entity: { isIrrevocable: true, entityType: "llc" },
          annualExclusionAmount: 19_000,
          crummeyBeneficiaryCount: 0,
        },
      ),
    ).toThrow(/trust/i);
  });

  it("irrevocable trust, Crummey on, 0 beneficiaries → all lifetime", () => {
    const r = computeGiftTaxTreatment(
      giftTo({
        amount: 50_000,
        useCrummeyPowers: true,
        recipientEntityId: "t1",
      }),
      {
        entity: { isIrrevocable: true, entityType: "trust" },
        annualExclusionAmount: 19_000,
        crummeyBeneficiaryCount: 0,
      },
    );
    expect(r).toEqual({
      lifetimeUsed: 50_000,
      annualExcluded: 0,
      charitableExcluded: 0,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/gifts/__tests__/compute-tax-treatment.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/gifts/compute-tax-treatment.ts
export type GiftInput = {
  amount: number;
  useCrummeyPowers: boolean;
  recipientEntityId: string | null;
  recipientFamilyMemberId: string | null;
  recipientExternalBeneficiaryId: string | null;
};

export type EntityType =
  | "trust"
  | "llc"
  | "s_corp"
  | "c_corp"
  | "partnership"
  | "foundation"
  | "other";

export type GiftContext = {
  entity?: { isIrrevocable: boolean; entityType: EntityType };
  external?: { kind: "charity" | "individual" };
  annualExclusionAmount: number;
  crummeyBeneficiaryCount: number;
};

export type GiftTreatment = {
  lifetimeUsed: number;
  annualExcluded: number;
  charitableExcluded: number;
};

export function computeGiftTaxTreatment(
  gift: GiftInput,
  ctx: GiftContext,
): GiftTreatment {
  if (gift.recipientEntityId) {
    if (!ctx.entity) {
      throw new Error(
        "computeGiftTaxTreatment: entity context required for entity recipient",
      );
    }
    if (ctx.entity.entityType !== "trust") {
      throw new Error(
        "computeGiftTaxTreatment: entity recipient must be a trust",
      );
    }
    if (!ctx.entity.isIrrevocable) {
      throw new Error(
        "computeGiftTaxTreatment: gifts to revocable trusts are not completed gifts",
      );
    }

    if (!gift.useCrummeyPowers || ctx.crummeyBeneficiaryCount <= 0) {
      return {
        lifetimeUsed: gift.amount,
        annualExcluded: 0,
        charitableExcluded: 0,
      };
    }

    const annual = Math.min(
      gift.amount,
      ctx.annualExclusionAmount * ctx.crummeyBeneficiaryCount,
    );
    return {
      lifetimeUsed: gift.amount - annual,
      annualExcluded: annual,
      charitableExcluded: 0,
    };
  }

  if (gift.recipientFamilyMemberId) {
    const annual = Math.min(gift.amount, ctx.annualExclusionAmount);
    return {
      lifetimeUsed: gift.amount - annual,
      annualExcluded: annual,
      charitableExcluded: 0,
    };
  }

  if (gift.recipientExternalBeneficiaryId) {
    if (!ctx.external) {
      throw new Error(
        "computeGiftTaxTreatment: external context required for external recipient",
      );
    }
    if (ctx.external.kind === "charity") {
      return {
        lifetimeUsed: 0,
        annualExcluded: 0,
        charitableExcluded: gift.amount,
      };
    }
    const annual = Math.min(gift.amount, ctx.annualExclusionAmount);
    return {
      lifetimeUsed: gift.amount - annual,
      annualExcluded: annual,
      charitableExcluded: 0,
    };
  }

  throw new Error("computeGiftTaxTreatment: no recipient set");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/gifts/__tests__/compute-tax-treatment.test.ts`
Expected: PASS (all 10 cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/gifts/compute-tax-treatment.ts src/lib/gifts/__tests__/compute-tax-treatment.test.ts
git commit -m "feat(gifts): add computeGiftTaxTreatment helper"
```

---

### Task 2: `resolveAnnualExclusion` helper

**Files:**
- Create: `src/lib/gifts/resolve-annual-exclusion.ts`
- Test: `src/lib/gifts/__tests__/resolve-annual-exclusion.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/gifts/__tests__/resolve-annual-exclusion.test.ts
import { describe, it, expect } from "vitest";
import { resolveAnnualExclusion, type TaxYearRow } from "../resolve-annual-exclusion";

const row = (year: number, value: number): TaxYearRow => ({
  year,
  giftAnnualExclusion: value,
});

describe("resolveAnnualExclusion", () => {
  it("returns the seeded value when the year is present", () => {
    const rows: TaxYearRow[] = [row(2024, 18_000), row(2025, 19_000), row(2026, 19_000)];
    expect(resolveAnnualExclusion(2025, rows, 0.025)).toBe(19_000);
  });

  it("projects forward from latest year, rounds to nearest 1000", () => {
    const rows: TaxYearRow[] = [row(2024, 18_000), row(2025, 19_000), row(2026, 19_000)];
    // 19_000 × 1.025 = 19_475 → round to 19_000
    expect(resolveAnnualExclusion(2027, rows, 0.025)).toBe(19_000);
    // 19_000 × 1.025^2 = 19_962 → round to 20_000
    expect(resolveAnnualExclusion(2028, rows, 0.025)).toBe(20_000);
    // 19_000 × 1.025^10 ≈ 24_320 → round to 24_000
    expect(resolveAnnualExclusion(2036, rows, 0.025)).toBe(24_000);
  });

  it("falls back to 18000 when rows are empty", () => {
    expect(resolveAnnualExclusion(2030, [], 0.025)).toBe(18_000);
  });

  it("projects from the max year even when rows arrive unsorted", () => {
    const rows: TaxYearRow[] = [row(2025, 19_000), row(2024, 18_000), row(2026, 19_000)];
    // 19_000 × 1.025 = 19_475 → 19_000
    expect(resolveAnnualExclusion(2027, rows, 0.025)).toBe(19_000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/gifts/__tests__/resolve-annual-exclusion.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/gifts/resolve-annual-exclusion.ts
export type TaxYearRow = {
  year: number;
  giftAnnualExclusion: number;
};

const FALLBACK = 18_000;

export function resolveAnnualExclusion(
  year: number,
  rows: TaxYearRow[],
  inflationRate: number,
): number {
  const hit = rows.find((r) => r.year === year);
  if (hit) return hit.giftAnnualExclusion;

  if (rows.length === 0) return FALLBACK;

  const latest = rows.reduce((acc, r) => (r.year > acc.year ? r : acc), rows[0]);
  const years = year - latest.year;
  const projected =
    latest.giftAnnualExclusion * Math.pow(1 + inflationRate, years);
  return Math.round(projected / 1000) * 1000;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/gifts/__tests__/resolve-annual-exclusion.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/gifts/resolve-annual-exclusion.ts src/lib/gifts/__tests__/resolve-annual-exclusion.test.ts
git commit -m "feat(gifts): add resolveAnnualExclusion helper with inflation projection"
```

---

### Task 3: `computeExemptionLedger` helper

**Files:**
- Create: `src/lib/gifts/compute-ledger.ts`
- Test: `src/lib/gifts/__tests__/compute-ledger.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/gifts/__tests__/compute-ledger.test.ts
import { describe, it, expect } from "vitest";
import {
  computeExemptionLedger,
  type LedgerGift,
  type LedgerContext,
} from "../compute-ledger";

const ctx: LedgerContext = {
  entitiesById: {
    trust1: { isIrrevocable: true, entityType: "trust" },
  },
  externalsById: {},
  beneficiaryCountsByEntityId: {},
  annualExclusionByYear: {
    2026: 19_000,
  },
};

describe("computeExemptionLedger", () => {
  it("single gift from client to irrevocable trust → one ledger entry", () => {
    const gifts: LedgerGift[] = [
      {
        id: "g1",
        year: 2026,
        amount: 2_400_000,
        grantor: "client",
        useCrummeyPowers: false,
        recipientEntityId: "trust1",
        recipientFamilyMemberId: null,
        recipientExternalBeneficiaryId: null,
      },
    ];
    const r = computeExemptionLedger(gifts, ctx);
    expect(r).toEqual([
      {
        grantor: "client",
        year: 2026,
        lifetimeUsedThisYear: 2_400_000,
        cumulativeLifetimeUsed: 2_400_000,
      },
    ]);
  });

  it("joint gift splits 50/50 into two grantor entries", () => {
    const gifts: LedgerGift[] = [
      {
        id: "g1",
        year: 2026,
        amount: 2_400_000,
        grantor: "joint",
        useCrummeyPowers: false,
        recipientEntityId: "trust1",
        recipientFamilyMemberId: null,
        recipientExternalBeneficiaryId: null,
      },
    ];
    const r = computeExemptionLedger(gifts, ctx);
    expect(r).toEqual([
      {
        grantor: "client",
        year: 2026,
        lifetimeUsedThisYear: 1_200_000,
        cumulativeLifetimeUsed: 1_200_000,
      },
      {
        grantor: "spouse",
        year: 2026,
        lifetimeUsedThisYear: 1_200_000,
        cumulativeLifetimeUsed: 1_200_000,
      },
    ]);
  });

  it("multi-year cumulative sums per grantor", () => {
    const gifts: LedgerGift[] = [
      {
        id: "g1",
        year: 2026,
        amount: 1_000_000,
        grantor: "client",
        useCrummeyPowers: false,
        recipientEntityId: "trust1",
        recipientFamilyMemberId: null,
        recipientExternalBeneficiaryId: null,
      },
      {
        id: "g2",
        year: 2027,
        amount: 500_000,
        grantor: "client",
        useCrummeyPowers: false,
        recipientEntityId: "trust1",
        recipientFamilyMemberId: null,
        recipientExternalBeneficiaryId: null,
      },
      {
        id: "g3",
        year: 2027,
        amount: 300_000,
        grantor: "spouse",
        useCrummeyPowers: false,
        recipientEntityId: "trust1",
        recipientFamilyMemberId: null,
        recipientExternalBeneficiaryId: null,
      },
    ];
    const ctx2: LedgerContext = {
      ...ctx,
      annualExclusionByYear: { 2026: 19_000, 2027: 19_000 },
    };
    const r = computeExemptionLedger(gifts, ctx2);
    expect(r).toEqual([
      {
        grantor: "client",
        year: 2026,
        lifetimeUsedThisYear: 1_000_000,
        cumulativeLifetimeUsed: 1_000_000,
      },
      {
        grantor: "client",
        year: 2027,
        lifetimeUsedThisYear: 500_000,
        cumulativeLifetimeUsed: 1_500_000,
      },
      {
        grantor: "spouse",
        year: 2027,
        lifetimeUsedThisYear: 300_000,
        cumulativeLifetimeUsed: 300_000,
      },
    ]);
  });

  it("skips zero-lifetime gifts (annual-excluded, charitable)", () => {
    const gifts: LedgerGift[] = [
      {
        id: "g1",
        year: 2026,
        amount: 10_000,
        grantor: "client",
        useCrummeyPowers: false,
        recipientEntityId: null,
        recipientFamilyMemberId: "fm1",
        recipientExternalBeneficiaryId: null,
      },
    ];
    const r = computeExemptionLedger(gifts, ctx);
    expect(r).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/gifts/__tests__/compute-ledger.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/gifts/compute-ledger.ts
import {
  computeGiftTaxTreatment,
  type EntityType,
} from "./compute-tax-treatment";

export type LedgerGift = {
  id: string;
  year: number;
  amount: number;
  grantor: "client" | "spouse" | "joint";
  useCrummeyPowers: boolean;
  recipientEntityId: string | null;
  recipientFamilyMemberId: string | null;
  recipientExternalBeneficiaryId: string | null;
};

export type LedgerContext = {
  entitiesById: Record<
    string,
    { isIrrevocable: boolean; entityType: EntityType }
  >;
  externalsById: Record<string, { kind: "charity" | "individual" }>;
  beneficiaryCountsByEntityId: Record<string, number>;
  annualExclusionByYear: Record<number, number>;
};

export type LedgerEntry = {
  grantor: "client" | "spouse";
  year: number;
  lifetimeUsedThisYear: number;
  cumulativeLifetimeUsed: number;
};

export function computeExemptionLedger(
  gifts: LedgerGift[],
  ctx: LedgerContext,
): LedgerEntry[] {
  // Tally lifetime usage per (grantor, year).
  const byKey = new Map<string, number>();

  for (const g of gifts) {
    const entity = g.recipientEntityId
      ? ctx.entitiesById[g.recipientEntityId]
      : undefined;
    const external = g.recipientExternalBeneficiaryId
      ? ctx.externalsById[g.recipientExternalBeneficiaryId]
      : undefined;
    const annualExclusionAmount = ctx.annualExclusionByYear[g.year] ?? 0;
    const crummeyBeneficiaryCount = g.recipientEntityId
      ? ctx.beneficiaryCountsByEntityId[g.recipientEntityId] ?? 0
      : 0;

    const treatment = computeGiftTaxTreatment(
      {
        amount: g.amount,
        useCrummeyPowers: g.useCrummeyPowers,
        recipientEntityId: g.recipientEntityId,
        recipientFamilyMemberId: g.recipientFamilyMemberId,
        recipientExternalBeneficiaryId: g.recipientExternalBeneficiaryId,
      },
      {
        entity,
        external,
        annualExclusionAmount,
        crummeyBeneficiaryCount,
      },
    );

    if (treatment.lifetimeUsed === 0) continue;

    const allocations: Array<["client" | "spouse", number]> =
      g.grantor === "joint"
        ? [
            ["client", treatment.lifetimeUsed / 2],
            ["spouse", treatment.lifetimeUsed / 2],
          ]
        : [[g.grantor, treatment.lifetimeUsed]];

    for (const [grantor, amt] of allocations) {
      const key = `${grantor}|${g.year}`;
      byKey.set(key, (byKey.get(key) ?? 0) + amt);
    }
  }

  // Group → sorted entries with running cumulative totals per grantor.
  const entries: LedgerEntry[] = [];
  for (const [key, total] of byKey.entries()) {
    const [grantor, yearStr] = key.split("|");
    entries.push({
      grantor: grantor as "client" | "spouse",
      year: Number(yearStr),
      lifetimeUsedThisYear: total,
      cumulativeLifetimeUsed: 0, // filled in below
    });
  }
  entries.sort(
    (a, b) => (a.grantor === b.grantor ? a.year - b.year : a.grantor < b.grantor ? -1 : 1),
  );
  const running = new Map<"client" | "spouse", number>();
  for (const e of entries) {
    const prev = running.get(e.grantor) ?? 0;
    e.cumulativeLifetimeUsed = prev + e.lifetimeUsedThisYear;
    running.set(e.grantor, e.cumulativeLifetimeUsed);
  }
  return entries;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/gifts/__tests__/compute-ledger.test.ts`
Expected: PASS (all 4 cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/gifts/compute-ledger.ts src/lib/gifts/__tests__/compute-ledger.test.ts
git commit -m "feat(gifts): add computeExemptionLedger with per-grantor cumulative totals"
```

---

### Task 4: Schema — `gifts` table + `gift_annual_exclusion` column

**Files:**
- Modify: `src/db/schema.ts`

- [ ] **Step 1: Add the new column to `tax_year_parameters`**

Find the `taxYearParameters` pgTable declaration (around line 811). Inside it, add a new field. Place it next to an existing decimal value for visual clarity (e.g., right before `createdAt`):

```ts
giftAnnualExclusion: decimal("gift_annual_exclusion", { precision: 10, scale: 2 })
  .notNull()
  .default("0"),
```

(The migration will backfill real values; `"0"` default is safe because no column reads it yet; the helper falls back to `18000` at runtime if every row is 0.)

- [ ] **Step 2: Add the `gifts` pgTable**

Place after the existing `entities` + family-members + externalBeneficiaries blocks, logically near the other estate-planning data. A clean location is below `beneficiaryDesignations`:

```ts
export const gifts = pgTable(
  "gifts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    year: integer("year").notNull(),
    amount: decimal("amount", { precision: 15, scale: 2 }).notNull(),
    grantor: ownerEnum("grantor").notNull(),
    recipientEntityId: uuid("recipient_entity_id").references(() => entities.id, {
      onDelete: "cascade",
    }),
    recipientFamilyMemberId: uuid("recipient_family_member_id").references(
      () => familyMembers.id,
      { onDelete: "cascade" },
    ),
    recipientExternalBeneficiaryId: uuid(
      "recipient_external_beneficiary_id",
    ).references(() => externalBeneficiaries.id, { onDelete: "cascade" }),
    useCrummeyPowers: boolean("use_crummey_powers").notNull().default(false),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("gifts_client_year_idx").on(t.clientId, t.year),
    index("gifts_client_grantor_year_idx").on(t.clientId, t.grantor, t.year),
  ],
);
```

CHECK constraints are added manually in the migration (Task 5).

- [ ] **Step 3: Add relations**

Near the existing `beneficiaryDesignationsRelations` block, append:

```ts
export const giftsRelations = relations(gifts, ({ one }) => ({
  client: one(clients, {
    fields: [gifts.clientId],
    references: [clients.id],
  }),
  recipientEntity: one(entities, {
    fields: [gifts.recipientEntityId],
    references: [entities.id],
  }),
  recipientFamilyMember: one(familyMembers, {
    fields: [gifts.recipientFamilyMemberId],
    references: [familyMembers.id],
  }),
  recipientExternalBeneficiary: one(externalBeneficiaries, {
    fields: [gifts.recipientExternalBeneficiaryId],
    references: [externalBeneficiaries.id],
  }),
}));
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.ts
git commit -m "feat(schema): gifts table + gift_annual_exclusion on tax_year_parameters"
```

---

### Task 5: Migration 0040

**Files:**
- Create: `src/db/migrations/0040_gifts.sql`
- May also create/modify: `src/db/migrations/meta/0040_snapshot.json`, `src/db/migrations/meta/_journal.json`

- [ ] **Step 1: Generate the migration**

Run: `npx drizzle-kit generate --name gifts`

Expected output: `src/db/migrations/0040_gifts.sql` with a `CREATE TABLE "gifts"` statement, two `CREATE INDEX` statements, and `ALTER TABLE "tax_year_parameters" ADD COLUMN "gift_annual_exclusion" numeric(10, 2) DEFAULT '0' NOT NULL`. If the CLI rejects `--name`, run without and rename the generated file + journal entry to `0040_gifts`.

- [ ] **Step 2: Append CHECK constraints + seed IRS values**

Open `src/db/migrations/0040_gifts.sql` and append:

```sql
--> statement-breakpoint
ALTER TABLE "gifts"
  ADD CONSTRAINT "gifts_recipient_exactly_one" CHECK (
    (recipient_entity_id IS NOT NULL AND recipient_family_member_id IS NULL AND recipient_external_beneficiary_id IS NULL) OR
    (recipient_entity_id IS NULL AND recipient_family_member_id IS NOT NULL AND recipient_external_beneficiary_id IS NULL) OR
    (recipient_entity_id IS NULL AND recipient_family_member_id IS NULL AND recipient_external_beneficiary_id IS NOT NULL)
  );
--> statement-breakpoint
ALTER TABLE "gifts"
  ADD CONSTRAINT "gifts_amount_positive" CHECK (amount > 0);
--> statement-breakpoint
UPDATE "tax_year_parameters" SET "gift_annual_exclusion" = 18000 WHERE "year" <= 2024;
--> statement-breakpoint
UPDATE "tax_year_parameters" SET "gift_annual_exclusion" = 19000 WHERE "year" IN (2025, 2026);
```

- [ ] **Step 3: Apply the migration**

`npx drizzle-kit migrate` first. Verify via `information_schema` or psql that the new table exists with the two CHECK constraints + two indexes, and that `tax_year_parameters.gift_annual_exclusion` has the seeded values. If the neon-http driver silently skips (pattern seen in items 1-2), apply manually via a tsx scratch script splitting on `--> statement-breakpoint` (see item 1 Task 4 commit for the reference approach). Also ensure `drizzle.__drizzle_migrations` has the row for 0040.

- [ ] **Step 4: Commit**

```bash
git add src/db/migrations/0040_gifts.sql src/db/migrations/meta/_journal.json src/db/migrations/meta/0040_snapshot.json
git commit -m "feat(migration): 0040 gifts table + check constraints + gift_annual_exclusion seed"
```

---

### Task 6: Zod schemas for gifts

**Files:**
- Create: `src/lib/schemas/gifts.ts`
- Test: `src/lib/schemas/__tests__/gifts.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/schemas/__tests__/gifts.test.ts
import { describe, it, expect } from "vitest";
import { giftCreateSchema, giftUpdateSchema } from "../gifts";

const UUID = "11111111-1111-1111-1111-111111111111";

describe("giftCreateSchema", () => {
  it("accepts a minimal gift to a trust", () => {
    const r = giftCreateSchema.safeParse({
      year: 2026,
      amount: 2_400_000,
      grantor: "client",
      recipientEntityId: UUID,
      useCrummeyPowers: false,
    });
    expect(r.success).toBe(true);
  });

  it("rejects when more than one recipient is set", () => {
    const r = giftCreateSchema.safeParse({
      year: 2026,
      amount: 100,
      grantor: "client",
      recipientEntityId: UUID,
      recipientFamilyMemberId: UUID,
      useCrummeyPowers: false,
    });
    expect(r.success).toBe(false);
  });

  it("rejects when no recipient is set", () => {
    const r = giftCreateSchema.safeParse({
      year: 2026,
      amount: 100,
      grantor: "client",
      useCrummeyPowers: false,
    });
    expect(r.success).toBe(false);
  });

  it("rejects amount ≤ 0", () => {
    const r = giftCreateSchema.safeParse({
      year: 2026,
      amount: 0,
      grantor: "client",
      recipientEntityId: UUID,
      useCrummeyPowers: false,
    });
    expect(r.success).toBe(false);
  });

  it("rejects year out of plausible range", () => {
    const r = giftCreateSchema.safeParse({
      year: 1800,
      amount: 100,
      grantor: "client",
      recipientEntityId: UUID,
      useCrummeyPowers: false,
    });
    expect(r.success).toBe(false);
  });
});

describe("giftUpdateSchema", () => {
  it("accepts a partial update of amount only", () => {
    const r = giftUpdateSchema.safeParse({ amount: 50_000 });
    expect(r.success).toBe(true);
  });

  it("rejects a partial update setting two recipients at once", () => {
    const r = giftUpdateSchema.safeParse({
      recipientEntityId: UUID,
      recipientFamilyMemberId: UUID,
    });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/schemas/__tests__/gifts.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/schemas/gifts.ts
import { z } from "zod";

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidSchema = z.string().regex(uuidRegex, "Invalid UUID format");

const base = {
  year: z.number().int().gte(1900).lte(2200),
  amount: z.number().gt(0),
  grantor: z.enum(["client", "spouse", "joint"]),
  recipientEntityId: uuidSchema.optional().nullable(),
  recipientFamilyMemberId: uuidSchema.optional().nullable(),
  recipientExternalBeneficiaryId: uuidSchema.optional().nullable(),
  useCrummeyPowers: z.boolean().optional().default(false),
  notes: z.string().trim().nullish(),
};

function exactlyOneRecipient(d: {
  recipientEntityId?: string | null;
  recipientFamilyMemberId?: string | null;
  recipientExternalBeneficiaryId?: string | null;
}): boolean {
  const count = [
    d.recipientEntityId,
    d.recipientFamilyMemberId,
    d.recipientExternalBeneficiaryId,
  ].filter((x) => x != null).length;
  return count === 1;
}

export const giftCreateSchema = z.object(base).superRefine((d, ctx) => {
  if (!exactlyOneRecipient(d)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "Exactly one of recipientEntityId, recipientFamilyMemberId, or recipientExternalBeneficiaryId must be set.",
    });
  }
});

export const giftUpdateSchema = z
  .object(
    Object.fromEntries(
      Object.entries(base).map(([k, v]) => [k, (v as z.ZodTypeAny).optional()]),
    ) as Record<string, z.ZodTypeAny>,
  )
  .superRefine((d, ctx) => {
    const patch = d as {
      recipientEntityId?: string | null;
      recipientFamilyMemberId?: string | null;
      recipientExternalBeneficiaryId?: string | null;
    };
    // Only enforce exactly-one when at least one recipient field is present
    // (even if set to null). This lets callers touch other fields without
    // re-sending recipient info.
    const touchedRecipient =
      "recipientEntityId" in patch ||
      "recipientFamilyMemberId" in patch ||
      "recipientExternalBeneficiaryId" in patch;
    if (touchedRecipient && !exactlyOneRecipient(patch)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "When updating recipient fields, exactly one of the three must be non-null.",
      });
    }
  });

export type GiftCreateInput = z.infer<typeof giftCreateSchema>;
export type GiftUpdateInput = z.infer<typeof giftUpdateSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/schemas/__tests__/gifts.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/schemas/gifts.ts src/lib/schemas/__tests__/gifts.test.ts
git commit -m "feat(schemas): zod schemas for gift create/update"
```

---

### Task 7: API route — list + create

**Files:**
- Create: `src/app/api/clients/[id]/gifts/route.ts`

- [ ] **Step 1: Write the route**

```ts
// src/app/api/clients/[id]/gifts/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  clients,
  gifts,
  entities,
  familyMembers,
  externalBeneficiaries,
} from "@/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";
import { giftCreateSchema } from "@/lib/schemas/gifts";

export const dynamic = "force-dynamic";

async function verifyClient(clientId: string, firmId: string) {
  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.firmId, firmId)));
  return !!client;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const firmId = await getOrgId();
    const { id } = await params;
    if (!(await verifyClient(id, firmId))) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    const rows = await db
      .select()
      .from(gifts)
      .where(eq(gifts.clientId, id))
      .orderBy(asc(gifts.year), asc(gifts.createdAt));
    return NextResponse.json(rows);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/clients/[id]/gifts error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const firmId = await getOrgId();
    const { id } = await params;
    if (!(await verifyClient(id, firmId))) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    const body = await request.json();
    const parsed = giftCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid body", issues: parsed.error.issues },
        { status: 400 },
      );
    }
    const data = parsed.data;

    // Cross-firm injection guard: the referenced recipient must belong to
    // this client. Also enforces the recipient-kind rule on entities.
    if (data.recipientEntityId) {
      const [entity] = await db
        .select({
          id: entities.id,
          entityType: entities.entityType,
          isIrrevocable: entities.isIrrevocable,
        })
        .from(entities)
        .where(
          and(
            eq(entities.id, data.recipientEntityId),
            eq(entities.clientId, id),
          ),
        );
      if (!entity) {
        return NextResponse.json(
          { error: "Recipient entity not found for this client" },
          { status: 400 },
        );
      }
      if (entity.entityType !== "trust") {
        return NextResponse.json(
          {
            error:
              "Recipient must be a trust (gifts to LLCs / foundations / etc. are not supported)",
          },
          { status: 400 },
        );
      }
      if (!entity.isIrrevocable) {
        return NextResponse.json(
          {
            error:
              "Gifts to revocable trusts are not completed gifts; no exemption is used",
          },
          { status: 400 },
        );
      }
    }
    if (data.recipientFamilyMemberId) {
      const [fm] = await db
        .select({ id: familyMembers.id })
        .from(familyMembers)
        .where(
          and(
            eq(familyMembers.id, data.recipientFamilyMemberId),
            eq(familyMembers.clientId, id),
          ),
        );
      if (!fm) {
        return NextResponse.json(
          { error: "Recipient family member not found for this client" },
          { status: 400 },
        );
      }
    }
    if (data.recipientExternalBeneficiaryId) {
      const [ext] = await db
        .select({ id: externalBeneficiaries.id })
        .from(externalBeneficiaries)
        .where(
          and(
            eq(externalBeneficiaries.id, data.recipientExternalBeneficiaryId),
            eq(externalBeneficiaries.clientId, id),
          ),
        );
      if (!ext) {
        return NextResponse.json(
          { error: "Recipient external beneficiary not found for this client" },
          { status: 400 },
        );
      }
    }

    const [row] = await db
      .insert(gifts)
      .values({
        clientId: id,
        year: data.year,
        amount: String(data.amount),
        grantor: data.grantor,
        recipientEntityId: data.recipientEntityId ?? null,
        recipientFamilyMemberId: data.recipientFamilyMemberId ?? null,
        recipientExternalBeneficiaryId:
          data.recipientExternalBeneficiaryId ?? null,
        useCrummeyPowers: data.useCrummeyPowers ?? false,
        notes: data.notes ?? null,
      })
      .returning();
    return NextResponse.json(row, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("POST /api/clients/[id]/gifts error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/clients/[id]/gifts/route.ts"
git commit -m "feat(api): GET/POST gifts with recipient-kind + tenant validation"
```

---

### Task 8: API route — update + delete

**Files:**
- Create: `src/app/api/clients/[id]/gifts/[giftId]/route.ts`

- [ ] **Step 1: Write the route**

```ts
// src/app/api/clients/[id]/gifts/[giftId]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  clients,
  gifts,
  entities,
  familyMembers,
  externalBeneficiaries,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";
import { giftUpdateSchema } from "@/lib/schemas/gifts";

export const dynamic = "force-dynamic";

async function verifyClient(clientId: string, firmId: string) {
  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.firmId, firmId)));
  return !!client;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; giftId: string }> },
) {
  try {
    const firmId = await getOrgId();
    const { id, giftId } = await params;
    if (!(await verifyClient(id, firmId))) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    const body = await request.json();
    const parsed = giftUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid body", issues: parsed.error.issues },
        { status: 400 },
      );
    }
    const patch = parsed.data as {
      year?: number;
      amount?: number;
      grantor?: "client" | "spouse" | "joint";
      recipientEntityId?: string | null;
      recipientFamilyMemberId?: string | null;
      recipientExternalBeneficiaryId?: string | null;
      useCrummeyPowers?: boolean;
      notes?: string | null;
    };

    // Cross-firm injection guard when recipient fields are touched.
    if (patch.recipientEntityId) {
      const [entity] = await db
        .select({
          id: entities.id,
          entityType: entities.entityType,
          isIrrevocable: entities.isIrrevocable,
        })
        .from(entities)
        .where(
          and(
            eq(entities.id, patch.recipientEntityId),
            eq(entities.clientId, id),
          ),
        );
      if (!entity) {
        return NextResponse.json(
          { error: "Recipient entity not found for this client" },
          { status: 400 },
        );
      }
      if (entity.entityType !== "trust") {
        return NextResponse.json(
          { error: "Recipient must be a trust" },
          { status: 400 },
        );
      }
      if (!entity.isIrrevocable) {
        return NextResponse.json(
          { error: "Gifts to revocable trusts are not completed gifts" },
          { status: 400 },
        );
      }
    }
    if (patch.recipientFamilyMemberId) {
      const [fm] = await db
        .select({ id: familyMembers.id })
        .from(familyMembers)
        .where(
          and(
            eq(familyMembers.id, patch.recipientFamilyMemberId),
            eq(familyMembers.clientId, id),
          ),
        );
      if (!fm) {
        return NextResponse.json(
          { error: "Recipient family member not found for this client" },
          { status: 400 },
        );
      }
    }
    if (patch.recipientExternalBeneficiaryId) {
      const [ext] = await db
        .select({ id: externalBeneficiaries.id })
        .from(externalBeneficiaries)
        .where(
          and(
            eq(externalBeneficiaries.id, patch.recipientExternalBeneficiaryId),
            eq(externalBeneficiaries.clientId, id),
          ),
        );
      if (!ext) {
        return NextResponse.json(
          { error: "Recipient external beneficiary not found for this client" },
          { status: 400 },
        );
      }
    }

    const [row] = await db
      .update(gifts)
      .set({
        ...(patch.year !== undefined && { year: patch.year }),
        ...(patch.amount !== undefined && { amount: String(patch.amount) }),
        ...(patch.grantor !== undefined && { grantor: patch.grantor }),
        ...(patch.recipientEntityId !== undefined && {
          recipientEntityId: patch.recipientEntityId ?? null,
        }),
        ...(patch.recipientFamilyMemberId !== undefined && {
          recipientFamilyMemberId: patch.recipientFamilyMemberId ?? null,
        }),
        ...(patch.recipientExternalBeneficiaryId !== undefined && {
          recipientExternalBeneficiaryId:
            patch.recipientExternalBeneficiaryId ?? null,
        }),
        ...(patch.useCrummeyPowers !== undefined && {
          useCrummeyPowers: patch.useCrummeyPowers,
        }),
        ...(patch.notes !== undefined && { notes: patch.notes ?? null }),
        updatedAt: new Date(),
      })
      .where(and(eq(gifts.id, giftId), eq(gifts.clientId, id)))
      .returning();

    if (!row) {
      return NextResponse.json({ error: "Gift not found" }, { status: 404 });
    }
    return NextResponse.json(row);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("PATCH /api/clients/[id]/gifts/[giftId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; giftId: string }> },
) {
  try {
    const firmId = await getOrgId();
    const { id, giftId } = await params;
    if (!(await verifyClient(id, firmId))) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    const [row] = await db
      .delete(gifts)
      .where(and(eq(gifts.id, giftId), eq(gifts.clientId, id)))
      .returning();
    if (!row) {
      return NextResponse.json({ error: "Gift not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("DELETE /api/clients/[id]/gifts/[giftId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/clients/[id]/gifts/[giftId]/route.ts"
git commit -m "feat(api): PATCH/DELETE gift"
```

---

### Task 9: Engine types + projection-data loader

**Files:**
- Modify: `src/engine/types.ts`
- Modify: `src/app/api/clients/[id]/projection-data/route.ts`

- [ ] **Step 1: Extend `ClientData` with `gifts`**

In `src/engine/types.ts`, add a new interface near other input types:

```ts
export interface Gift {
  id: string;
  year: number;
  amount: number;
  grantor: "client" | "spouse" | "joint";
  recipientEntityId?: string;
  recipientFamilyMemberId?: string;
  recipientExternalBeneficiaryId?: string;
  useCrummeyPowers: boolean;
}
```

Then extend `ClientData` to include:

```ts
gifts?: Gift[];
```

(Alongside the existing optional input arrays.)

- [ ] **Step 2: Load gifts in `projection-data/route.ts`**

Add `gifts` to the `@/db/schema` import (already imports several tables). Before the big `return NextResponse.json({...})` block, add:

```ts
const giftRows = await db
  .select()
  .from(gifts)
  .where(eq(gifts.clientId, id))
  .orderBy(asc(gifts.year), asc(gifts.createdAt));
```

Inside the returned payload object, add:

```ts
gifts: giftRows.map((g) => ({
  id: g.id,
  year: g.year,
  amount: parseFloat(g.amount),
  grantor: g.grantor,
  recipientEntityId: g.recipientEntityId ?? undefined,
  recipientFamilyMemberId: g.recipientFamilyMemberId ?? undefined,
  recipientExternalBeneficiaryId: g.recipientExternalBeneficiaryId ?? undefined,
  useCrummeyPowers: g.useCrummeyPowers,
})),
```

- [ ] **Step 3: Typecheck + engine tests**

```bash
npx tsc --noEmit
npx vitest run src/engine
```

Both should be clean.

- [ ] **Step 4: Commit**

```bash
git add src/engine/types.ts "src/app/api/clients/[id]/projection-data/route.ts"
git commit -m "feat(engine-input): attach gifts to engine input (data only)"
```

---

### Task 10: UI — load gifts on Family page

**Files:**
- Modify: `src/app/(app)/clients/[id]/client-data/family/page.tsx`

- [ ] **Step 1: Fetch gifts alongside existing data**

Extend the `Promise.all([...])` block to include gifts:

```ts
db
  .select()
  .from(gifts)
  .where(eq(gifts.clientId, id))
  .orderBy(asc(gifts.year), asc(gifts.createdAt)),
```

Add `gifts` to the destructure on the left-hand side as `giftRows`:

```ts
const [memberRows, entityRows, externalRows, accountRows, designationRows, giftRows] =
  await Promise.all([ ... ]);
```

And add `gifts` to the schema import line (already imports `accounts`, `externalBeneficiaries`, `beneficiaryDesignations`).

- [ ] **Step 2: Shape gifts and pass to `<FamilyView>`**

After the existing `designations` map, add:

```ts
const giftsList = giftRows.map((g) => ({
  id: g.id,
  year: g.year,
  amount: parseFloat(g.amount),
  grantor: g.grantor,
  recipientEntityId: g.recipientEntityId ?? null,
  recipientFamilyMemberId: g.recipientFamilyMemberId ?? null,
  recipientExternalBeneficiaryId: g.recipientExternalBeneficiaryId ?? null,
  useCrummeyPowers: g.useCrummeyPowers,
  notes: g.notes ?? null,
}));
```

Update the JSX return:

```tsx
return (
  <FamilyView
    clientId={id}
    primary={primary}
    initialMembers={members}
    initialEntities={ents}
    initialExternalBeneficiaries={externals}
    initialAccounts={accts}
    initialDesignations={designations}
    initialGifts={giftsList}
  />
);
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors in `FamilyView` props (expected — fixed in Task 11).

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/clients/[id]/client-data/family/page.tsx"
git commit -m "feat(ui): load gifts on family page"
```

---

### Task 11: UI — Gifts section + trust-card footer + opening-balance relabel

**Files:**
- Modify: `src/components/family-view.tsx`

- [ ] **Step 1: Add new prop type + extend `FamilyViewProps`**

Near other exported types, add:

```ts
export type Gift = {
  id: string;
  year: number;
  amount: number;
  grantor: "client" | "spouse" | "joint";
  recipientEntityId: string | null;
  recipientFamilyMemberId: string | null;
  recipientExternalBeneficiaryId: string | null;
  useCrummeyPowers: boolean;
  notes: string | null;
};
```

Extend `FamilyViewProps`:

```ts
initialGifts: Gift[];
```

Add a module-level constant for the lifetime cap:

```ts
// Section-6 FUTURE_WORK: source from tax_year_parameters when portability/DSUE
// work lands; for now this matches the 2026 federal exemption used in the
// design handoff.
const LIFETIME_EXEMPTION_CAP = 13_990_000;
```

- [ ] **Step 2: Import ledger helpers**

```ts
import {
  computeGiftTaxTreatment,
  type GiftContext,
} from "@/lib/gifts/compute-tax-treatment";
```

- [ ] **Step 3: Wire state inside `FamilyView`**

Convert `initialGifts` to local state in the same pattern as existing `accts`, `designations`:

```ts
const [giftsState, setGiftsState] = useState<Gift[]>(props.initialGifts);
```

- [ ] **Step 4: Add a Gifts section**

Below the existing External Beneficiaries section, add:

```tsx
<GiftsSection
  clientId={props.clientId}
  members={members}
  externals={externals}
  entities={props.initialEntities}
  designations={designations}
  gifts={giftsState}
  onChange={setGiftsState}
/>
```

Then implement `GiftsSection` as a local subcomponent with:

- A table listing gifts (Year, Grantor, Amount, Recipient name, Crummey checkmark, Notes, Actions).
- An "Add Gift" button that opens an inline form (`GiftRowForm`) below the table.
- Edit / Delete row actions using `PATCH` / `DELETE` endpoints.
- Recipient resolution: look up the entity/familyMember/external by id against `props.entities`, `members`, `externals` and display the display name.

```tsx
type RecipientKind = "trust" | "family" | "external";

function GiftsSection(props: {
  clientId: string;
  members: FamilyMember[];
  externals: ExternalBeneficiary[];
  entities: Entity[];
  designations: Designation[];
  gifts: Gift[];
  onChange: (gifts: Gift[]) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const resolveRecipient = (g: Gift): { label: string; kind: RecipientKind } | null => {
    if (g.recipientEntityId) {
      const e = props.entities.find((x) => x.id === g.recipientEntityId);
      return e ? { label: e.name, kind: "trust" } : null;
    }
    if (g.recipientFamilyMemberId) {
      const m = props.members.find((x) => x.id === g.recipientFamilyMemberId);
      return m ? { label: `${m.firstName} ${m.lastName ?? ""}`.trim(), kind: "family" } : null;
    }
    if (g.recipientExternalBeneficiaryId) {
      const e = props.externals.find(
        (x) => x.id === g.recipientExternalBeneficiaryId,
      );
      return e ? { label: e.name, kind: "external" } : null;
    }
    return null;
  };

  async function deleteGift(giftId: string) {
    const res = await fetch(`/api/clients/${props.clientId}/gifts/${giftId}`, {
      method: "DELETE",
    });
    if (res.ok) {
      props.onChange(props.gifts.filter((x) => x.id !== giftId));
    }
  }

  return (
    <section className="mt-6 rounded-lg border border-gray-700 bg-gray-900 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-300">
          Gifts
        </h3>
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-500"
        >
          {adding ? "Cancel" : "+ Add gift"}
        </button>
      </div>

      {adding && (
        <GiftRowForm
          clientId={props.clientId}
          members={props.members}
          externals={props.externals}
          entities={props.entities}
          onSaved={(newGift) => {
            props.onChange([...props.gifts, newGift]);
            setAdding(false);
          }}
          onCancel={() => setAdding(false)}
        />
      )}

      {props.gifts.length === 0 ? (
        <p className="text-sm text-gray-500">No gifts recorded.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase text-gray-400">
              <th className="px-2 py-1">Year</th>
              <th className="px-2 py-1">Grantor</th>
              <th className="px-2 py-1 text-right">Amount</th>
              <th className="px-2 py-1">Recipient</th>
              <th className="px-2 py-1">Crummey</th>
              <th className="px-2 py-1">Notes</th>
              <th className="px-2 py-1"></th>
            </tr>
          </thead>
          <tbody>
            {props.gifts.map((g) => {
              const r = resolveRecipient(g);
              return (
                <tr key={g.id} className="border-t border-gray-800">
                  <td className="px-2 py-1">{g.year}</td>
                  <td className="px-2 py-1 capitalize">{g.grantor}</td>
                  <td className="px-2 py-1 text-right">
                    ${g.amount.toLocaleString()}
                  </td>
                  <td className="px-2 py-1">{r?.label ?? "—"}</td>
                  <td className="px-2 py-1">{g.useCrummeyPowers ? "✓" : ""}</td>
                  <td className="px-2 py-1 text-gray-400">{g.notes ?? ""}</td>
                  <td className="px-2 py-1 text-right">
                    <button
                      type="button"
                      onClick={() => deleteGift(g.id)}
                      className="text-xs text-red-400 hover:text-red-300"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

function GiftRowForm(props: {
  clientId: string;
  members: FamilyMember[];
  externals: ExternalBeneficiary[];
  entities: Entity[];
  onSaved: (g: Gift) => void;
  onCancel: () => void;
}) {
  const trusts = props.entities.filter(
    (e) => e.entityType === "trust" && e.isIrrevocable === true,
  );
  const [year, setYear] = useState<string>(`${new Date().getFullYear()}`);
  const [grantor, setGrantor] = useState<"client" | "spouse" | "joint">("client");
  const [amount, setAmount] = useState<string>("0");
  const [kind, setKind] = useState<RecipientKind>("trust");
  const [recipientId, setRecipientId] = useState<string>("");
  const [crummey, setCrummey] = useState(false);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedTrust = trusts.find((t) => t.id === recipientId);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        year: Number(year),
        amount: Number(amount),
        grantor,
        useCrummeyPowers: kind === "trust" ? crummey : false,
        notes: notes.trim() || null,
      };
      if (!recipientId) {
        throw new Error("Please select a recipient.");
      }
      if (kind === "trust") body.recipientEntityId = recipientId;
      if (kind === "family") body.recipientFamilyMemberId = recipientId;
      if (kind === "external") body.recipientExternalBeneficiaryId = recipientId;

      const res = await fetch(`/api/clients/${props.clientId}/gifts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      const row = await res.json();
      props.onSaved({
        id: row.id,
        year: row.year,
        amount: typeof row.amount === "string" ? parseFloat(row.amount) : row.amount,
        grantor: row.grantor,
        recipientEntityId: row.recipientEntityId ?? null,
        recipientFamilyMemberId: row.recipientFamilyMemberId ?? null,
        recipientExternalBeneficiaryId: row.recipientExternalBeneficiaryId ?? null,
        useCrummeyPowers: row.useCrummeyPowers,
        notes: row.notes ?? null,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mb-3 rounded border border-gray-700 bg-gray-800 p-3 space-y-2">
      <div className="grid grid-cols-4 gap-2">
        <div>
          <label className="text-xs text-gray-400">Year</label>
          <input
            type="number"
            min={1900}
            max={2200}
            value={year}
            onChange={(e) => setYear(e.target.value)}
            className="mt-1 block w-full rounded border border-gray-600 bg-gray-900 px-2 py-1 text-sm text-gray-100"
          />
        </div>
        <div>
          <label className="text-xs text-gray-400">Grantor</label>
          <select
            value={grantor}
            onChange={(e) =>
              setGrantor(e.target.value as "client" | "spouse" | "joint")
            }
            className="mt-1 block w-full rounded border border-gray-600 bg-gray-900 px-2 py-1 text-sm text-gray-100"
          >
            <option value="client">Client</option>
            <option value="spouse">Spouse</option>
            <option value="joint">Joint</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-400">Amount ($)</label>
          <input
            type="number"
            min={0}
            step={1000}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="mt-1 block w-full rounded border border-gray-600 bg-gray-900 px-2 py-1 text-sm text-gray-100"
          />
        </div>
        <div>
          <label className="text-xs text-gray-400">Recipient kind</label>
          <select
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as RecipientKind);
              setRecipientId("");
              setCrummey(false);
            }}
            className="mt-1 block w-full rounded border border-gray-600 bg-gray-900 px-2 py-1 text-sm text-gray-100"
          >
            <option value="trust">Irrevocable trust</option>
            <option value="family">Family member</option>
            <option value="external">Charity / external</option>
          </select>
        </div>
      </div>

      <div>
        <label className="text-xs text-gray-400">Recipient</label>
        <select
          value={recipientId}
          onChange={(e) => setRecipientId(e.target.value)}
          className="mt-1 block w-full rounded border border-gray-600 bg-gray-900 px-2 py-1 text-sm text-gray-100"
        >
          <option value="">— select —</option>
          {kind === "trust" &&
            trusts.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          {kind === "family" &&
            props.members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.firstName} {m.lastName ?? ""}
              </option>
            ))}
          {kind === "external" &&
            props.externals.map((ex) => (
              <option key={ex.id} value={ex.id}>
                {ex.name} ({ex.kind})
              </option>
            ))}
        </select>
      </div>

      {kind === "trust" && selectedTrust && (
        <label className="flex items-center gap-2 text-sm text-gray-200">
          <input
            type="checkbox"
            checked={crummey}
            onChange={(e) => setCrummey(e.target.checked)}
          />
          Use Crummey powers (annual-exclusion per beneficiary)
        </label>
      )}

      <div>
        <label className="text-xs text-gray-400">Notes</label>
        <input
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="mt-1 block w-full rounded border border-gray-600 bg-gray-900 px-2 py-1 text-sm text-gray-100"
        />
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="flex gap-2">
        <button
          type="button"
          disabled={saving}
          onClick={save}
          className="rounded bg-blue-600 px-3 py-1 text-sm text-white disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={props.onCancel}
          className="rounded bg-gray-700 px-3 py-1 text-sm text-gray-100"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Render exemption footer inside each trust `<details>` expander**

Find the existing per-trust `<details>` block (added in item 1 for remainder beneficiaries). Inside the `<details>` body, above or below the existing `<BeneficiaryEditor>`, add:

```tsx
{(() => {
  const openingBalance = parseFloat(e.exemptionConsumed || "0");
  const beneficiaryCount = designations.filter(
    (d) => d.targetKind === "trust" && d.entityId === e.id && d.tier === "primary",
  ).length;
  const lifetimeFromGifts = giftsState
    .filter((g) => g.recipientEntityId === e.id)
    .reduce((acc, g) => {
      try {
        const treatment = computeGiftTaxTreatment(
          {
            amount: g.amount,
            useCrummeyPowers: g.useCrummeyPowers,
            recipientEntityId: g.recipientEntityId,
            recipientFamilyMemberId: g.recipientFamilyMemberId,
            recipientExternalBeneficiaryId: g.recipientExternalBeneficiaryId,
          },
          {
            entity: {
              isIrrevocable: e.isIrrevocable ?? false,
              entityType: "trust",
            },
            annualExclusionAmount: 19_000, // UI-side default; engine will use year-indexed value
            crummeyBeneficiaryCount: beneficiaryCount,
          } as GiftContext,
        );
        return acc + treatment.lifetimeUsed;
      } catch {
        return acc; // revocable/non-trust throws — shouldn't render for non-trust rows
      }
    }, 0);
  const total = openingBalance + lifetimeFromGifts;
  return (
    <p className="mt-2 border-t border-gray-800 pt-2 text-xs text-gray-400">
      Uses exemption · ${(total / 1_000_000).toFixed(2)}M / ${(LIFETIME_EXEMPTION_CAP / 1_000_000).toFixed(2)}M
    </p>
  );
})()}
```

(The `annualExclusionAmount: 19_000` hard-coded in the UI is a FUTURE_WORK bullet — sourcing it from `resolveAnnualExclusion` + `tax_year_parameters` requires wiring those rows into the Family page too. Note deliberately kept out of scope for this session.)

- [ ] **Step 6: Relabel `exemption_consumed` input in `EntityDialog`**

Find the existing exemption-consumed label inside `EntityDialog` (added in item 2). Replace its label + helper text:

- Label: `"Opening balance (legacy)"`
- Helper line: `"Historical exemption already used before you started tracking individual gifts. Gifts added below stack on top."`

Keep the input `name="exemptionConsumed"` and semantics unchanged.

- [ ] **Step 7: Typecheck + dev smoke**

```bash
npx tsc --noEmit
npm run dev
```

Open the Family page for a test client. Verify:
- Gifts section renders with "No gifts recorded." initially.
- Adding a gift to an irrevocable trust with Crummey on / off persists and shows in the table.
- Adding a gift to a family member persists.
- Opening a trust `<details>` shows the "Uses exemption" footer.
- Adding a gift to an entity + revaluing opens with a 400 error from the server (revocable trusts).

- [ ] **Step 8: Commit**

```bash
git add src/components/family-view.tsx
git commit -m "feat(ui): gifts section + trust-card exemption footer + opening-balance relabel"
```

---

### Task 12: Tenant-isolation tests

**Files:**
- Create: `src/__tests__/gifts-tenant-isolation.test.ts`

- [ ] **Step 1: Confirm the structural contract test still passes**

Run: `npx vitest run src/__tests__/tenant-isolation.test.ts`
Expected: PASS. The gift routes all call `getOrgId()` + `verifyClient`.

- [ ] **Step 2: Write the behavior test**

Model after the existing `src/__tests__/beneficiaries-tenant-isolation.test.ts`: `.env.local` loader at top, `vi.mock("@/lib/db-helpers", () => ({ getOrgId: vi.fn() }))`, per-firm `setupFirmWithClient` helper, scoped cleanup.

```ts
// src/__tests__/gifts-tenant-isolation.test.ts
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";

// Env loader: same trick as beneficiaries-tenant-isolation. See that file
// for the exact loader; the pattern is: if process.env.DATABASE_URL is not
// set and .env.local exists in cwd, parse it and set keys onto process.env.
// Required because src/db/index.ts reads DATABASE_URL at module init.
beforeAll(async () => {
  // Inline minimal loader; keep identical to the beneficiaries test for
  // consistency.
});

vi.mock("@/lib/db-helpers", () => ({
  getOrgId: vi.fn(),
}));

const FIRM_A = "firm_gifts_test_a";
const FIRM_B = "firm_gifts_test_b";

describe("gifts tenant isolation", () => {
  // Setup + cleanup factories identical in spirit to
  // beneficiaries-tenant-isolation.test.ts. They insert a client + scenario +
  // family member + account + an irrevocable trust entity per firm.

  beforeEach(async () => {
    // cleanup scoped to FIRM_A + FIRM_B
  });

  it("Firm B cannot GET Firm A's gifts list", async () => {
    // seed FIRM_A gift to its own trust
    // mock getOrgId to FIRM_B
    // call GET → expect status 404
  });

  it("Firm B cannot POST a gift to Firm A's client", async () => {
    // mock getOrgId to FIRM_B
    // POST to FIRM_A clientId → expect 404
  });

  it("Firm A cannot POST a gift with Firm B's trust as the recipient", async () => {
    // seed FIRM_A + FIRM_B
    // mock getOrgId to FIRM_A
    // POST with recipientEntityId = FIRM_B's trust → expect 400
  });

  it("Firm A cannot POST a gift with Firm B's family member as the recipient", async () => {
    // mock getOrgId to FIRM_A
    // POST with recipientFamilyMemberId = FIRM_B's family member → expect 400
  });

  it("POST to a revocable trust recipient returns 400", async () => {
    // seed FIRM_A with one revocable trust entity
    // POST with its id as recipientEntityId → expect 400
  });
});
```

Use the same structure (imports + env loader + factories) as
`beneficiaries-tenant-isolation.test.ts`. The exact scaffolding is in that file — copy it; only the per-test bodies change.

When writing the implementation, read `src/__tests__/beneficiaries-tenant-isolation.test.ts` and replicate its helper functions (`setupFirmWithClient`, `cleanup`) inside this new file with the additional step of creating an irrevocable trust row on the setup side. The trust seed looks like:

```ts
const [trust] = await db
  .insert(entities)
  .values({
    clientId: client.id,
    name: `${firmId} trust`,
    entityType: "trust",
    trustSubType: "slat",
    isIrrevocable: true,
  } as any)
  .returning();
```

- [ ] **Step 3: Run the tests**

Run: `npx vitest run src/__tests__/gifts-tenant-isolation.test.ts`
Expected: PASS (5 cases). If `.env.local` is missing, skip with `describe.skipIf(!process.env.DATABASE_URL)` per the existing pattern.

Ensure lint passes on this file:

```bash
npm run lint -- src/__tests__/gifts-tenant-isolation.test.ts
```

Add `// eslint-disable-next-line @typescript-eslint/no-explicit-any` comments on the test-only `as any` casts (same pattern as the beneficiaries test).

- [ ] **Step 4: Commit**

```bash
git add src/__tests__/gifts-tenant-isolation.test.ts
git commit -m "test: tenant isolation for gifts (cross-firm + revocable-trust rejection)"
```

---

### Task 13: Update `docs/FUTURE_WORK.md`

**Files:**
- Modify: `docs/FUTURE_WORK.md`

- [ ] **Step 1: Append deferred items**

Append at the end of the file:

```markdown
## Gift Exemption Ledger (shipped 2026-04-20)

- **Engine: gifts reduce grantor household balance in the gift year.** Why deferred: engine behavior; lands with item 4/5 alongside death-sequence events.
- **Estate-tax + lifetime-cap enforcement + portability / DSUE.** Why deferred: items 4–5 territory.
- **Migrate `entities.exemption_consumed` opening balances → gift rows and drop the column.** Why deferred: pragmatic dual representation; can migrate after item 4 wires the ledger into engine math.
- **Gift-splitting elections beyond 50/50 joint.** Why deferred: edge case rarely used outside gift-to-spouse-of-grantor scenarios.
- **GST tax tracking on skip-person gifts.** Why deferred: separate generational-skipping-tax model; items 4–5 at earliest.
- **ILIT three-year look-back rule on gift-of-policy.** Why deferred: item 7 (life-insurance primitives) owns this.
- **`LIFETIME_EXEMPTION_CAP` + UI `annualExclusionAmount` sourced from `tax_year_parameters` with sunset handling.** Why deferred: sunset logic is its own concern; a module-level constant is enough to render the trust-card footer for v1.
```

- [ ] **Step 2: Commit**

```bash
git add docs/FUTURE_WORK.md
git commit -m "docs: track gift-exemption-ledger deferred items"
```

---

### Task 14: Regression + final review

- [ ] **Step 1: Full test run**

Run: `npm run test`
Expected: all green. Helper + schema tests should take total counts up by ~25.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Lint spot-check**

Run:

```bash
npm run lint -- src/lib/gifts src/lib/schemas/gifts.ts "src/app/api/clients/[id]/gifts" src/__tests__/gifts-tenant-isolation.test.ts src/components/family-view.tsx "src/app/(app)/clients/[id]/client-data/family/page.tsx" src/engine/types.ts "src/app/api/clients/[id]/projection-data/route.ts"
```

Expected: no errors on new/touched files. Fix any.

- [ ] **Step 4: Cross-check spec coverage**

Re-read [docs/superpowers/specs/2026-04-20-gift-exemption-ledger-design.md](../specs/2026-04-20-gift-exemption-ledger-design.md) section by section. Every deliverable has a task above — helpers, Zod, API, UI, engine, tests, FUTURE_WORK.

- [ ] **Step 5: Request final code review**

Invoke `superpowers:requesting-code-review` against the spec.
