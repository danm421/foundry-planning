// src/lib/whatif/translate-techniques.ts
//
// Technique changes: a plain shape in, the exact record the Solver builds out.
// Uses the Solver's own builders so a Claude what-if is indistinguishable from
// one built on the Solver screen.
import type { Account, AssetTransaction, ClientData, RothConversion } from "@/engine/types";
import type { EstateFlowGift } from "@/lib/estate/estate-flow-gifts";
import { isPaydownEligible } from "@/lib/solver/debt-paydown";
import { buildQuickAddAccount } from "@/lib/solver/quick-add-account";
import {
  cashflowUpsertMutation,
  DEFAULT_INCOME_TAX_TYPE,
  type CashflowDraft,
} from "@/lib/solver/quick-add-cashflow";
import type { SolverMutation } from "@/lib/solver/types";
import type { USPSStateCode } from "@/lib/usps-states";
import { FILLABLE_BRACKETS, type WhatIfChange } from "./changes";
import {
  type Ctx,
  type One,
  fail,
  familyMemberFor,
  findAccount,
  findLiability,
  requireSpouse,
  requireYear,
  requireYearRange,
} from "./translate-context";

export type TechniqueChange = Extract<
  WhatIfChange,
  {
    type:
      | "roth_conversion"
      | "asset_sale"
      | "asset_purchase"
      | "gift"
      | "relocation"
      | "pay_off_debt"
      | "add_income"
      | "add_expense"
      | "add_account"
      | "remove";
  }
>;

// The same lists the Roth conversion form offers (add-roth-conversion-form.tsx).
const ROTH_SOURCE_SUBTYPES = new Set(["traditional_ira", "401k", "403b", "sep_ira", "simple_ira"]);
const SELLABLE: ReadonlySet<Account["category"]> = new Set(["taxable", "real_estate", "business"]);
const PROCEEDS: ReadonlySet<Account["category"]> = new Set(["cash", "taxable"]);

/** The one family member who owns 100% of an account, or null when shared. */
function soleFamilyOwner(a: Account): string | null {
  const fm = a.owners.flatMap((o) => (o.kind === "family_member" ? [o] : []));
  return fm.length === 1 && fm[0].percent >= 0.999 ? fm[0].familyMemberId : null;
}

function rothName(change: Extract<TechniqueChange, { type: "roth_conversion" }>): string {
  if (change.name) return change.name;
  switch (change.mode) {
    case "fill_bracket":
      return `Roth conversion — fill the ${Math.round((change.bracket ?? 0) * 100)}% bracket`;
    case "fixed_amount":
      return `Roth conversion — $${Math.round(change.amount ?? 0).toLocaleString("en-US")} a year`;
    case "deplete_over_period":
      return "Roth conversion — spread over the period";
    case "full_account":
      return "Roth conversion — whole account";
  }
}

/** The calendar year a person retires, from their birth year and retirement age. */
function retirementYear(tree: ClientData, person: "client" | "spouse"): number {
  const dob = person === "client" ? tree.client.dateOfBirth : tree.client.spouseDob;
  const age = person === "client" ? tree.client.retirementAge : (tree.client.spouseRetirementAge ?? tree.client.retirementAge);
  if (!dob) return tree.planSettings.planEndYear;
  return Math.min(Number(dob.slice(0, 4)) + age, tree.planSettings.planEndYear);
}

export function translateTechnique(change: TechniqueChange, ctx: Ctx): One {
  const ps = ctx.tree.planSettings;
  switch (change.type) {
    case "roth_conversion": {
      const to = findAccount(ctx, change.toAccountId);
      if (to.category !== "retirement" || to.subType !== "roth_ira" || to.inheritedDeathYear != null) {
        fail(ctx, `${to.name} isn't a Roth IRA the household owns, so it can't receive a conversion.`);
      }
      if (new Set(change.fromAccountIds).size !== change.fromAccountIds.length) {
        fail(ctx, "an account is listed twice in fromAccountIds.");
      }
      const toOwner = soleFamilyOwner(to);
      const sources = change.fromAccountIds.map((id) => findAccount(ctx, id));
      for (const s of sources) {
        if (s.id === to.id) fail(ctx, `${s.name} can't be both the source and the destination.`);
        if (s.category !== "retirement" || !ROTH_SOURCE_SUBTYPES.has(s.subType) || s.inheritedDeathYear != null) {
          fail(ctx, `${s.name} isn't a pre-tax retirement account (traditional IRA, 401k, 403b, SEP or SIMPLE).`);
        }
        const sOwner = soleFamilyOwner(s);
        if (sOwner && toOwner && sOwner !== toOwner) {
          fail(ctx, `${s.name} and ${to.name} have different owners; a conversion stays with one owner.`);
        }
      }
      if (change.endYear !== undefined) requireYearRange(ctx, change.startYear, change.endYear);
      else requireYear(ctx, change.startYear, "startYear");
      if (change.mode === "fixed_amount" && change.amount === undefined) fail(ctx, "fixed_amount needs an amount.");
      if (change.mode === "fill_bracket" && !(FILLABLE_BRACKETS as readonly number[]).includes(change.bracket ?? -1)) {
        fail(ctx, `fill_bracket needs bracket set to one of ${FILLABLE_BRACKETS.join(", ")}.`);
      }
      if (change.mode === "deplete_over_period" && change.endYear === undefined) {
        fail(ctx, "deplete_over_period needs an endYear.");
      }
      const id = ctx.newId();
      const value: RothConversion = {
        id,
        enabled: true,
        name: rothName(change),
        destinationAccountId: to.id,
        sourceAccountIds: sources.map((s) => s.id),
        conversionType: change.mode === "fill_bracket" ? "fill_up_bracket" : change.mode,
        fixedAmount: change.amount ?? 0,
        ...(change.mode === "fill_bracket" ? { fillUpBracket: change.bracket } : {}),
        irmaaCapTier: change.irmaaCapTier ?? null,
        startYear: change.startYear,
        ...(change.endYear !== undefined ? { endYear: change.endYear } : {}),
        indexingRate: change.indexingRate ?? 0,
      };
      return { mutations: [{ kind: "roth-conversion-upsert", id, value }], recordId: id };
    }

    case "asset_sale": {
      const acct = findAccount(ctx, change.accountId);
      if (!SELLABLE.has(acct.category)) {
        fail(ctx, `${acct.name} can't be sold in a what-if; sales cover taxable, real estate and business accounts.`);
      }
      requireYear(ctx, change.year);
      if (change.proceedsAccountId !== undefined) {
        const p = findAccount(ctx, change.proceedsAccountId);
        if (!PROCEEDS.has(p.category)) fail(ctx, `${p.name} can't receive sale proceeds; pick a cash or taxable account.`);
      }
      const id = ctx.newId();
      const value: AssetTransaction = {
        id,
        enabled: true,
        name: change.name ?? `Sell ${acct.name}`,
        type: "sell",
        year: change.year,
        accountId: acct.id,
        fractionSold: change.fraction !== undefined && change.fraction < 1 ? change.fraction : null,
        ...(change.proceedsAccountId !== undefined ? { proceedsAccountId: change.proceedsAccountId } : {}),
      };
      return { mutations: [{ kind: "asset-transaction-upsert", id, value }], recordId: id };
    }

    case "asset_purchase": {
      requireYear(ctx, change.year);
      if (change.fundingAccountId !== undefined) findAccount(ctx, change.fundingAccountId);
      if (change.mortgageAmount !== undefined && change.mortgageAmount > change.purchasePrice) {
        fail(ctx, "mortgageAmount is larger than purchasePrice.");
      }
      if (change.mortgageAmount && change.mortgageRate === undefined) {
        fail(ctx, "mortgageRate is required with a mortgageAmount.");
      }
      const id = ctx.newId();
      const value: AssetTransaction = {
        id,
        enabled: true,
        name: change.name,
        type: "buy",
        year: change.year,
        assetName: change.name,
        assetCategory: "real_estate",
        assetSubType: change.propertyType,
        purchasePrice: change.purchasePrice,
        basis: change.purchasePrice,
        growthRate:
          change.growthRate ?? ctx.growthDefaults?.realEstate ?? ps.defaultGrowthRealEstate ?? ps.inflationRate,
        ...(change.fundingAccountId !== undefined ? { fundingAccountId: change.fundingAccountId } : {}),
        ...(change.mortgageAmount
          ? {
              mortgageAmount: change.mortgageAmount,
              mortgageRate: change.mortgageRate,
              mortgageTermMonths: change.mortgageTermMonths ?? 360,
            }
          : {}),
        ...(change.annualPropertyTax !== undefined ? { annualPropertyTax: change.annualPropertyTax } : {}),
      };
      return { mutations: [{ kind: "asset-transaction-upsert", id, value }], recordId: id };
    }

    case "gift": {
      if ((change.familyMemberId === undefined) === (change.charityId === undefined)) {
        fail(ctx, "give exactly one of familyMemberId or charityId.");
      }
      if (change.grantor !== "client") requireSpouse(ctx, "spouse");
      let recipient: { kind: "family_member" | "external_beneficiary"; id: string };
      if (change.familyMemberId !== undefined) {
        const fm = (ctx.tree.familyMembers ?? []).find((f) => f.id === change.familyMemberId);
        if (!fm) fail(ctx, `family member ${change.familyMemberId} isn't in this plan. Get ids from list_plan_details with kind 'family_member'.`);
        if (fm.role === "client" || fm.role === "spouse") fail(ctx, "a gift must go to someone other than the client or spouse.");
        recipient = { kind: "family_member", id: fm.id };
      } else {
        const charity = (ctx.tree.externalBeneficiaries ?? []).find((b) => b.id === change.charityId && b.kind === "charity");
        if (!charity) fail(ctx, `charity ${change.charityId} isn't in this plan. Get ids from list_plan_details with kind 'external_beneficiary'.`);
        recipient = { kind: "external_beneficiary", id: charity.id };
      }
      const endYear = change.endYear ?? change.startYear;
      requireYearRange(ctx, change.startYear, endYear);
      const id = ctx.newId();
      const value: EstateFlowGift =
        endYear > change.startYear || change.annualExclusion
          ? {
              kind: "series",
              id,
              startYear: change.startYear,
              endYear,
              annualAmount: change.amount,
              amountMode: change.annualExclusion ? "annual_exclusion" : "fixed",
              inflationAdjust: false,
              grantor: change.grantor,
              recipient,
              crummey: false,
              enabled: true,
            }
          : {
              kind: "cash-once",
              id,
              year: change.startYear,
              amount: change.amount,
              grantor: change.grantor,
              recipient,
              crummey: false,
              eventKind: "outright",
              enabled: true,
            };
      return { mutations: [{ kind: "gift-upsert", id, value }], recordId: id };
    }

    case "relocation": {
      requireYear(ctx, change.year);
      const id = ctx.newId();
      return {
        mutations: [
          {
            kind: "relocation-upsert",
            id,
            value: {
              id,
              enabled: true,
              name: `Move to ${change.state}`,
              year: change.year,
              destinationState: change.state as USPSStateCode,
            },
          },
        ],
        recordId: id,
      };
    }

    case "pay_off_debt": {
      const liab = findLiability(ctx, change.liabilityId);
      if (!isPaydownEligible(liab)) fail(ctx, `${liab.name} can't take extra payments (it has no balance or is held flat).`);
      const endYear = change.frequency === "one_time" ? change.startYear : (change.endYear ?? change.startYear);
      requireYearRange(ctx, change.startYear, endYear);
      return {
        mutations: [
          {
            kind: "debt-paydown",
            liabilityId: liab.id,
            value: {
              liabilityId: liab.id,
              frequency: change.frequency,
              amount: change.amount,
              startYear: change.startYear,
              endYear,
              enabled: true,
            },
          },
        ],
        recordId: liab.id,
      };
    }

    case "add_income":
    case "add_expense": {
      if (change.type === "add_income" && change.owner !== "client") requireSpouse(ctx, "spouse");
      requireYearRange(ctx, change.startYear, change.endYear);
      const id = ctx.newId();
      const draft: CashflowDraft = {
        kind: change.type === "add_income" ? "income" : "expense",
        id,
        name: change.name,
        annualAmount: change.annualAmount,
        ...(change.type === "add_income" ? { owner: change.owner, taxType: DEFAULT_INCOME_TAX_TYPE } : {}),
        growthSource: change.growthRate === undefined ? "inflation" : "custom",
        growthRate: change.growthRate ?? ps.inflationRate,
        startYear: change.startYear,
        startYearRef: null,
        endYear: change.endYear,
        endYearRef: null,
      };
      return { mutations: [cashflowUpsertMutation(draft)], recordId: id };
    }

    case "add_account": {
      requireSpouse(ctx, change.owner);
      const owner = familyMemberFor(ctx, change.owner);
      const savings = change.annualSavings ?? 0;
      const startYear = change.savingsStartYear ?? ps.planStartYear;
      const endYear = change.savingsEndYear ?? retirementYear(ctx.tree, change.owner);
      if (savings > 0) requireYearRange(ctx, startYear, endYear);
      const category =
        change.accountType === "cash" ? "cash" : change.accountType === "taxable" ? "taxable" : "retirement";
      const rawDefault = {
        cash: ps.defaultGrowthCash,
        taxable: ps.defaultGrowthTaxable,
        retirement: ps.defaultGrowthRetirement,
      }[category];
      const defaultGrowth = ctx.growthDefaults?.[category] ?? rawDefault;
      const accountId = ctx.newId();
      const ruleId = ctx.newId();
      const { account, rule } = buildQuickAddAccount({
        type: change.accountType,
        ownerFamilyMemberId: owner.id,
        ownerLabel: owner.firstName,
        ...(change.name ? { name: change.name } : {}),
        annualAmount: savings,
        startYear,
        endYear,
        growthRate: change.growthRate ?? defaultGrowth ?? 0,
        // As the Solver's quick-add does: no rate given means the plan's
        // category default, which a saved scenario re-resolves on load.
        growthSource: change.growthRate === undefined ? "default" : "custom",
        accountId,
        ruleId,
        balance: change.balance,
      });
      const mutations: SolverMutation[] = [{ kind: "account-upsert", id: accountId, value: account }];
      if (savings > 0) mutations.push({ kind: "savings-rule-upsert", id: ruleId, value: rule });
      return { mutations, recordId: accountId };
    }

    case "remove": {
      const ids: Record<typeof change.kind, string[]> = {
        income: ctx.tree.incomes.map((r) => r.id),
        expense: ctx.tree.expenses.map((r) => r.id),
        account: ctx.tree.accounts.map((r) => r.id),
        liability: ctx.tree.liabilities.map((r) => r.id),
        roth_conversion: (ctx.tree.rothConversions ?? []).map((r) => r.id),
        asset_transaction: (ctx.tree.assetTransactions ?? []).map((r) => r.id),
      };
      if (!ids[change.kind].includes(change.id)) {
        fail(ctx, `${change.kind.replace("_", " ")} ${change.id} isn't in this plan.`);
      }
      const kind = {
        income: "income-upsert",
        expense: "expense-upsert",
        account: "account-upsert",
        liability: "liability-upsert",
        roth_conversion: "roth-conversion-upsert",
        asset_transaction: "asset-transaction-upsert",
      } as const;
      return {
        mutations: [{ kind: kind[change.kind], id: change.id, value: null } as SolverMutation],
        recordId: change.id,
      };
    }
  }
}
