// src/lib/scenario/__tests__/asset-transaction-overlay-numerics.test.ts
//
// Regression test for the scenario-overlay string-math hole (ruling C19's
// class: an overlay field that stays a STRING makes the engine's `+`
// CONCATENATE — "1500000" + 45000 = "150000045000", ~100x wrong).
//
// This test deliberately drives the REAL write path end to end:
//
//   the form's own body builder (`legToBody`)
//     → `applyEntityAdd` / `applyEntityEdit` (the only sanctioned writer)
//       → a real `scenario_changes` row, payload stored VERBATIM
//         → `loadEffectiveTree` → `applyScenarioChanges`
//           → `runProjection`
//
// It does NOT hand-build an overlay payload. That distinction is the whole
// point: `asset_transaction` is not in `resolveAddPayload`'s switch, so
// `NUMERIC_FIELDS_BY_KIND` is the ONLY thing standing between the string the
// form posts and the engine's arithmetic. A unit test on a pre-shaped overlay
// picks its own types and so cannot see this bug — which is why the suite was
// green while three money fields were corrupt.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { scenarios } from "@/db/schema";
import { runProjection } from "@/engine";
import type { Account, AssetTransaction } from "@/engine/types";
import { legToBody } from "@/components/forms/use-asset-transaction-legs";
import {
  emptyBuyLeg,
  emptySellLeg,
  type BuyLegDraft,
  type SellLegDraft,
} from "@/components/forms/asset-transaction-leg-model";
import { applyEntityAdd, applyEntityEdit } from "../changes-writer";
import { loadEffectiveTree } from "../loader";

const COOPER_CLIENT_ID = "877a9532-f8ea-49b0-9db7-aadd64fab82a";
const COOPER_FIRM_ID = "org_3CitTEIe8PJa1BVYw7LnEjkiP9r";
// The one asset_transaction on Cooper Sample's BASE CASE scenario ("Sell
// Rental", 2035). Editing a BASE row is the only way to reach
// `coerceEditValue`: `applyEntityEdit` folds an edit of a SCENARIO-ADDED row
// back into the `add` row's payload, which is coerced by `coerceEntityNumerics`
// instead. See the edit test at the bottom.
const COOPER_BASE_SELL_RENTAL_ID = "4216bba5-69a8-4aff-b941-b5871cf93673";

const PURCHASE_PRICE = 1_500_000;
const GROWTH_PCT = 3; // the form posts percent strings; 3 → "0.03"

const HAS_DB = !!process.env.DATABASE_URL;

describe.skipIf(!HAS_DB)("asset_transaction scenario overlay — numeric coercion", () => {
  let scenarioId: string;

  beforeEach(async () => {
    const [row] = await db
      .insert(scenarios)
      .values({
        clientId: COOPER_CLIENT_ID,
        name: `at-numerics-${randomUUID().slice(0, 8)}`,
        isBaseCase: false,
      })
      .returning();
    scenarioId = row.id;
  });

  afterEach(async () => {
    // ON DELETE CASCADE on scenario_changes.scenario_id cleans up child rows.
    await db.delete(scenarios).where(eq(scenarios.id, scenarioId));
  });

  /** Plan-start year + a cash account to fund the buy, read off the real base
   *  tree so the fixture can't drift out from under the test. */
  async function baseFixture() {
    const { effectiveTree } = await loadEffectiveTree(
      COOPER_CLIENT_ID,
      COOPER_FIRM_ID,
      "base",
      {},
    );
    const funding = effectiveTree.accounts.find(
      (a: Account) => a.category === "cash" && a.value > 0,
    );
    if (!funding) throw new Error("fixture: Cooper Sample has no funded cash account");
    return { tree: effectiveTree, fundingId: funding.id };
  }

  /** A buy leg with EVERY numeric input the buy side can carry filled in. */
  function fullBuyLeg(fundingId: string): BuyLegDraft {
    return {
      ...emptyBuyLeg("buy-1"),
      name: "Overlay numerics — buy",
      assetName: "45 Oak Ave",
      assetCategory: "real_estate",
      assetSubType: "primary_residence",
      purchasePrice: String(PURCHASE_PRICE),
      growthRate: String(GROWTH_PCT),
      basis: String(PURCHASE_PRICE),
      fundingAccountId: fundingId,
      showMortgage: true,
      mortgageAmount: "900000",
      mortgageRate: "6.5",
      mortgageTermMonths: "360",
      annualPropertyTax: "18000",
      propertyTaxGrowthRate: "3",
      propertyTaxGrowthSource: "custom",
    };
  }

  /** A sell leg with EVERY numeric input the sell side can carry filled in.
   *  `percent` populates `fractionSold`; `dollar` populates
   *  `overrideSaleValue`. The two modes are mutually exclusive in the form, so
   *  covering the whole sell surface takes one leg of each. */
  function fullSellLeg(
    sellAccountId: string,
    mode: "percent" | "dollar" = "percent",
  ): SellLegDraft {
    return {
      ...emptySellLeg(`sell-${mode}`),
      name: "Overlay numerics — sell",
      sellMode: "account",
      sellAccountId,
      sellAmountMode: mode,
      fractionSoldPct: "50",
      overrideSaleValue: mode === "dollar" ? "825000" : "",
      overrideBasis: "400000",
      transactionCostPct: "6",
      transactionCostFlat: "12500",
      proceedsAccountId: "",
    };
  }

  it("a scenario-added BUY keeps purchasePrice numeric — the engine must add, not concatenate", async () => {
    const { tree, fundingId } = await baseFixture();
    const buyYear = tree.planSettings.planStartYear + 1;

    // The body the dialog actually posts. `legToBody` is the production
    // builder — it emits purchasePrice/basis/mortgage* as STRINGS.
    const body = legToBody(fullBuyLeg(fundingId), buyYear, { isRealEstate: false });
    expect(typeof body.purchasePrice).toBe("string"); // pin the premise

    const id = randomUUID();
    await applyEntityAdd({
      scenarioId,
      firmId: COOPER_FIRM_ID,
      targetKind: "asset_transaction",
      entity: { id, ...body },
    });

    const { effectiveTree } = await loadEffectiveTree(
      COOPER_CLIENT_ID,
      COOPER_FIRM_ID,
      scenarioId,
      {},
    );
    const at = effectiveTree.assetTransactions?.find(
      (t: AssetTransaction) => t.id === id,
    );
    expect(at).toBeDefined();
    expect(typeof at!.purchasePrice).toBe("number");
    expect(typeof at!.basis).toBe("number");

    // The money proof: the synthetic asset must grow ~3%, not gain six digits.
    const years = runProjection(effectiveTree);
    const acctId = `technique-acct-${id}`;
    const after = years.find((y) => y.year === buyYear + 1);
    expect(after, `no projection row for ${buyYear + 1}`).toBeDefined();
    const value = after!.accountLedgers[acctId]?.beginningValue;
    expect(typeof value).toBe("number");
    // "1500000" + 45000 === "150000045000" — a band this tight fails hard on
    // concatenation while tolerating the engine's exact growth mechanics.
    expect(value).toBeGreaterThan(PURCHASE_PRICE);
    expect(value).toBeLessThan(PURCHASE_PRICE * 1.1);
  });

  it("a scenario-added SELL keeps every cost/override field numeric", async () => {
    const { tree, fundingId } = await baseFixture();
    const sellYear = tree.planSettings.planStartYear + 1;

    const body = legToBody(fullSellLeg(fundingId), sellYear, { isRealEstate: false });
    const id = randomUUID();
    await applyEntityAdd({
      scenarioId,
      firmId: COOPER_FIRM_ID,
      targetKind: "asset_transaction",
      entity: { id, ...body },
    });

    const { effectiveTree } = await loadEffectiveTree(
      COOPER_CLIENT_ID,
      COOPER_FIRM_ID,
      scenarioId,
      {},
    );
    const at = effectiveTree.assetTransactions?.find(
      (t: AssetTransaction) => t.id === id,
    );
    expect(at).toBeDefined();
    // `costPct * saleValue + costFlat` — a string costFlat concatenates.
    expect(typeof at!.transactionCostFlat).toBe("number");
    expect(typeof at!.transactionCostPct).toBe("number");
    expect(typeof at!.overrideBasis).toBe("number");
  });

  it("EVERY numeric field the form's body builder posts arrives as a number", async () => {
    const { tree, fundingId } = await baseFixture();
    const year = tree.planSettings.planStartYear + 1;

    // One buy leg and one sell leg between them cover the whole numeric
    // surface of `AssetTransaction`. Anything the builder emits as a string
    // that the engine types as `number` is a live string-math hole.
    const cases = [
      legToBody(fullBuyLeg(fundingId), year, { isRealEstate: false }),
      legToBody(fullSellLeg(fundingId, "percent"), year, { isRealEstate: false }),
      legToBody(fullSellLeg(fundingId, "dollar"), year, { isRealEstate: false }),
    ];

    const NUMERIC_ON_ENGINE_TYPE = [
      "year",
      "purchasePrice",
      "growthRate",
      "basis",
      "mortgageAmount",
      "mortgageRate",
      "mortgageTermMonths",
      "annualPropertyTax",
      "propertyTaxGrowthRate",
      "overrideSaleValue",
      "overrideBasis",
      "transactionCostPct",
      "transactionCostFlat",
      "fractionSold",
    ] as const;

    const ids: string[] = [];
    for (const body of cases) {
      const id = randomUUID();
      ids.push(id);
      await applyEntityAdd({
        scenarioId,
        firmId: COOPER_FIRM_ID,
        targetKind: "asset_transaction",
        entity: { id, ...body },
      });
    }

    const { effectiveTree } = await loadEffectiveTree(
      COOPER_CLIENT_ID,
      COOPER_FIRM_ID,
      scenarioId,
      {},
    );

    const offenders: string[] = [];
    for (const id of ids) {
      const at = effectiveTree.assetTransactions?.find(
        (t: AssetTransaction) => t.id === id,
      ) as Record<string, unknown> | undefined;
      expect(at, `overlay row ${id} missing from the effective tree`).toBeDefined();
      for (const f of NUMERIC_ON_ENGINE_TYPE) {
        const v = at![f];
        if (v == null) continue; // absent / explicitly null is fine
        if (typeof v !== "number") offenders.push(`${f}=${JSON.stringify(v)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("an EDIT of a BASE asset_transaction coerces through coerceEditValue too", async () => {
    const { tree } = await baseFixture();

    // `Sell Rental` lives on the base case, so this produces a real `edit`
    // row — `applyEntityEdit`'s add-collapse branch does not fire and the
    // payload lands in `applyEdit` → `coerceEditValue`, the OTHER consumer of
    // NUMERIC_FIELDS_BY_KIND.
    const baseRow = tree.assetTransactions?.find(
      (t: AssetTransaction) => t.id === COOPER_BASE_SELL_RENTAL_ID,
    );
    expect(
      baseRow,
      "fixture: Cooper Sample's base case no longer carries the Sell Rental transaction",
    ).toBeDefined();

    const body = legToBody(
      fullSellLeg(baseRow!.accountId ?? "", "dollar"),
      baseRow!.year,
      { isRealEstate: false },
    );
    expect(typeof body.transactionCostFlat).toBe("string"); // pin the premise

    await applyEntityEdit({
      scenarioId,
      firmId: COOPER_FIRM_ID,
      targetKind: "asset_transaction",
      targetId: COOPER_BASE_SELL_RENTAL_ID,
      desiredFields: body,
    });

    const { effectiveTree } = await loadEffectiveTree(
      COOPER_CLIENT_ID,
      COOPER_FIRM_ID,
      scenarioId,
      {},
    );
    const at = effectiveTree.assetTransactions?.find(
      (t: AssetTransaction) => t.id === COOPER_BASE_SELL_RENTAL_ID,
    );
    expect(at).toBeDefined();
    // `saleValue * costPct + costFlat` — a string costFlat concatenates.
    expect(typeof at!.transactionCostFlat).toBe("number");
    expect(at!.transactionCostFlat).toBe(12500);
    expect(typeof at!.overrideSaleValue).toBe("number");
    expect(at!.overrideSaleValue).toBe(825000);
    expect(typeof at!.overrideBasis).toBe("number");
    expect(typeof at!.transactionCostPct).toBe("number");
  });
});
