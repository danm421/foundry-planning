// src/lib/fact-finder/placement/map/real-estate-debts.ts
/**
 * Section maps for the Real Estate, Business & Debts page (D4): a property is
 * a real estate account; a business is a business account plus the income and
 * expense it owns; a loan is a liability linked to the property it's on, plus
 * a plan note for its escrow (spec § 8: the split between tax and insurance is
 * unknown). Pure.
 */
import { formatMoney } from "@/domain/forge/row-lines";
import { sameRef, type RecordRef } from "../../change-set";
import {
  BUSINESS_TAX_MAP, BUSINESS_TYPE_MAP, LIABILITY_TYPE_MAP, PROPERTY_TYPE_MAP, SECTION_ACCOUNT_CATEGORY, TITLING_MAP, valueFor,
} from "../../enums";
import type { FFRow } from "../../types";
import { findLiability, findProperty, hasCoClient, householdPerson, rowRecordRef } from "../refs";
import { monthsBetween, termMonthsFromYears, toFraction } from "../translate";
import { stringOf } from "../text";
import type { TargetDraft } from "../types";
import {
  bool, cellOf, DraftBuilder, fallbackAsOf, heldThrough, jointOnRecord, linkedRecord, num, planNoteDraft, putBalanceAsOf, putOwners, rate, sharesOf, text,
} from "./helpers";
import type { PlaceContext, SectionMap } from "./types";

/**
 * A property's "Mortgage on it". A loan with a Liabilities row is linked from
 * that row (LIAB_MAP). A loan only on the plan gets its own line here, setting
 * its property to this one — blocked when another property names it too.
 */
function mortgageLink(row: FFRow, property: DraftBuilder, ctx: PlaceContext): TargetDraft | null {
  const name = text(row, "mortgageName");
  if (name === null) return null;
  const loan = findLiability(ctx.refs, name);
  if (!loan.ok) {
    property.warn(`Mortgage on it: ${loan.reason}`);
    return null;
  }
  const listed = (ctx.state.sections.liab ?? []).some((liab) => {
    const ref = rowRecordRef(ctx.refs, "liab", liab.id, "liability");
    return ref !== null && sameRef(ref, loan.ref);
  });
  if (listed || loan.ref.ref !== "record") return null;
  const b = new DraftBuilder({ sectionId: "realestate", row, target: "liability", recordId: loan.ref.id, label: loan.label })
    .put("linkedPropertyId", property.ref, ["mortgageName"]);
  const naming = propertiesNaming(loan.ref, ctx).length;
  if (naming > 1) b.block(`${naming === 2 ? "Two" : naming} properties name "${loan.label}" as their mortgage — keep it on one.`, "mortgageName");
  return b.build();
}

export const REALESTATE_MAP: SectionMap = {
  sectionId: "realestate",
  placements: {
    propertyName: { to: "account.name" },
    propertyType: { to: "account.subType" },
    currentValue: { to: "account.value" },
    costBasis: { to: "account.basis" },
    owner: { to: "account.owners" },
    jointTitling: { to: "account.titlingType" },
    address: { to: "account.propertyAddress" },
    annualPropertyTax: { to: "account.annualPropertyTax" },
    // The link is stored on the loan: LIAB_MAP reads this column for a loan whose "Property it's on" is blank,
    // and a loan with no Liabilities row gets its own line here.
    mortgageName: { to: "liability.linkedPropertyId" },
    ownerEntity: { to: "account.owners" },
  },
  place(rows, ctx) {
    return rows.flatMap((row): TargetDraft[] => {
      const name = text(row, "propertyName");
      const address = text(row, "address");
      const record = linkedRecord(row, ctx, ["account"]);
      const b = new DraftBuilder({
        sectionId: "realestate", row, target: "account", recordId: record?.id ?? null,
        label: name ?? record?.label ?? address ?? "Property",
        fixed: { category: SECTION_ACCOUNT_CATEGORY.realestate },
      })
        .put("name", name, ["propertyName"])
        .put("subType", valueFor(PROPERTY_TYPE_MAP, text(row, "propertyType")), ["propertyType"])
        .put("value", num(row, "currentValue"), ["currentValue"])
        .put("basis", num(row, "costBasis"), ["costBasis"])   // cost basis — a property never has an after-tax basis
        .put("propertyAddress", address, ["address"])
        .put("annualPropertyTax", num(row, "annualPropertyTax"), ["annualPropertyTax"]);
      putOwners(b, row, ctx, record, "property");
      // Joint: the row's Owner, else (a blank Owner) the owners on record.
      const titling = valueFor(TITLING_MAP, text(row, "jointTitling"));
      const owner = text(row, "owner");
      if (titling && !(owner === "Joint" || (owner === null && jointOnRecord(record)))) b.warn("Joint titling is saved only when the owner is Joint.");
      else b.put("titlingType", titling, ["jointTitling"]);
      const loan = mortgageLink(row, b, ctx);
      return loan ? [b.build(), loan] : [b.build()];
    });
  },
};

const FLOWS = {
  income: { column: "annualIncome", type: "business", noun: "income", many: "incomes" },
  expense: { column: "annualExpense", type: "other", noun: "expenses", many: "expenses" },
} as const;

/** A business's Annual income / expense: the one income (expense) on the plan it owns (D8), else a new one owned by it. */
function flowDraft(target: "income" | "expense", row: FFRow, business: RecordRef, label: string, ctx: PlaceContext): TargetDraft | null {
  const { column, type, noun, many } = FLOWS[target];
  const amount = num(row, column);
  if (amount === null) return null;
  const owned = business.ref === "record" ? ctx.book.records[target].filter((r) => r.facts?.ownerAccountId === business.id) : [];
  const name = `${label} ${noun}`;
  const b = new DraftBuilder({
    sectionId: "business", row, target,
    recordId: owned.length === 1 ? owned[0].id : null,
    label: owned.length === 1 ? owned[0].label : name,
    // A new one follows inflation, as in Details (the create schema would default a flat 3%).
    ...(owned.length === 0 ? { fixed: { type, name, ownerAccountId: business, growthSource: "inflation" } } : {}),
  }).put("annualAmount", amount, [column]);
  if (owned.length === 0) b.put("start", { yearRef: "plan_start" }, []).put("end", { yearRef: "plan_end" }, []);
  if (owned.length > 1) b.block(`${label} has ${owned.length} ${many} on the plan — change them in Details.`, column);
  return b.build();
}

export const BUSINESS_MAP: SectionMap = {
  sectionId: "business",
  placements: {
    businessName: { to: "business_account.name" },
    businessType: { to: "business_account.businessType" },
    currentValue: { to: "business_account.value" },
    costBasis: { to: "business_account.basis" },
    ownersAndPercent: { to: "business_account.owners" },
    taxTreatment: { to: "business_account.businessTaxTreatment" },
    distributionPercent: { to: "business_account.distributionPolicyPercent" },   // a share of EARNINGS (spec § 8)
    annualIncome: { to: "income.annualAmount" },
    annualExpense: { to: "expense.annualAmount" },
  },
  place(rows, ctx) {
    return rows.flatMap((row): TargetDraft[] => {
      const name = text(row, "businessName");
      const record = linkedRecord(row, ctx, ["business_account"]);
      const recordId = record?.id ?? null;
      const label = name ?? record?.label ?? "Business";
      const b = new DraftBuilder({
        sectionId: "business", row, target: "business_account", recordId, label,
        fixed: { category: SECTION_ACCOUNT_CATEGORY.business },
      })
        .put("name", name, ["businessName"])
        .put("businessType", valueFor(BUSINESS_TYPE_MAP, text(row, "businessType")), ["businessType"])
        .put("value", num(row, "currentValue"), ["currentValue"])
        .put("basis", num(row, "costBasis"), ["costBasis"]);

      const owners = text(row, "ownersAndPercent");
      const held = heldThrough(ctx, record);
      if (held !== null) {
        if (owners !== null) b.warn(`This business is owned through ${held}.`);
      } else if (owners !== null) {
        const shares = sharesOf(owners, ctx, ["household", "family", "trust"]);
        if (!shares.ok) b.block(shares.reason, "ownersAndPercent");
        else b.put("owners", shares.shares.map((s) => ({ who: s.who, percent: toFraction(s.percent) })), ["ownersAndPercent"]);
      } else if (recordId === null) {
        // A blank on a new business is the client's alone when there's no co-client to share it — ownersOf's rule.
        if (hasCoClient(ctx.refs)) b.block('Name the owners and their shares, like "Mark 60%, Laura 40%".', "ownersAndPercent");
        else b.put("owners", [{ who: householdPerson("client"), percent: 1 }], ["ownersAndPercent"]);
      }
      b.put("businessTaxTreatment", valueFor(BUSINESS_TAX_MAP, text(row, "taxTreatment")), ["taxTreatment"])
        .put("distributionPolicyPercent", rate(row, "distributionPercent"), ["distributionPercent"]);

      const flows = (["income", "expense"] as const).flatMap((target) => flowDraft(target, row, b.ref, label, ctx) ?? []);
      return [b.build(), ...flows];
    });
  },
};

/** Real estate rows whose "Mortgage on it" names this loan, and the property each stands for. */
function propertiesNaming(loan: RecordRef, ctx: PlaceContext): { row: FFRow; ref: RecordRef; label: string }[] {
  return (ctx.state.sections.realestate ?? []).flatMap((row) => {
    const mortgage = text(row, "mortgageName");
    const found = mortgage === null ? null : findLiability(ctx.refs, mortgage);
    const ref = rowRecordRef(ctx.refs, "realestate", row.id, "account");
    if (!found?.ok || ref === null || !sameRef(found.ref, loan)) return [];
    return [{ row, ref, label: text(row, "propertyName") ?? text(row, "address") ?? "A property" }];
  });
}

/** "Property it's on", else the one property whose "Mortgage on it" names this loan. */
function linkProperty(b: DraftBuilder, row: FFRow, ctx: PlaceContext): void {
  const naming = propertiesNaming(b.ref, ctx);
  const named = text(row, "propertyName");
  if (named === null) {
    if (naming.length === 1) b.put("linkedPropertyId", naming[0].ref, [cellOf("realestate", naming[0].row, "mortgageName")]);
    else if (naming.length > 1) {
      b.block(`${naming.length === 2 ? "Two" : naming.length} properties name this loan in "Mortgage on it" — say which in "Property it's on".`, "propertyName");
    }
    return;
  }
  const property = findProperty(ctx.refs, named);
  if (!property.ok) {
    b.block(property.reason, "propertyName");
    return;
  }
  b.put("linkedPropertyId", property.ref, ["propertyName"]);
  for (const other of naming) {
    if (!sameRef(other.ref, property.ref)) {
      b.warn(`"${other.label}" also names this loan in "Mortgage on it" — it's saved on "${property.label}", from "Property it's on".`);
    }
  }
}

/**
 * Loan start and term. A blank Term comes from Matures: the months from the
 * loan's start — typed, else on record, else the balance's date, which then
 * becomes the start (the old import's deriveLiabilityTerm rule: the schedule
 * runs from today's balance to the payoff, inventing no loan history).
 */
function placeTerm(b: DraftBuilder, row: FFRow, startOnRecord: string | null, balanceDate: string | null): void {
  const start = text(row, "loanStart");
  const years = num(row, "termYears");
  const matures = text(row, "matures");
  b.put("start", start, ["loanStart"]);
  if (years !== null) {
    b.put("termMonths", termMonthsFromYears(years), ["termYears"]);
    return;
  }
  const typedAsOf = text(row, "balanceAsOf");
  const from = start ?? startOnRecord ?? typedAsOf ?? balanceDate;
  if (matures === null || from === null) return;   // no start to count from: a new loan's validation asks for one
  const months = monthsBetween(from, matures);
  if (months === null || months <= 0) {
    b.block("Matures is on or before the loan start — check both dates.", "matures");
    return;
  }
  if (start === null && startOnRecord === null) b.put("start", from, typedAsOf !== null ? ["balanceAsOf"] : []);
  b.put("termMonths", months, ["matures"]);
}

/** Monthly escrow → a plan note naming the loan, matched to the plan's notes by its exact words (D8). */
function escrowNote(row: FFRow, loan: string, ctx: PlaceContext): TargetDraft | null {
  const escrow = num(row, "monthlyEscrow");
  if (escrow === null || escrow <= 0) return null;
  const body = `${loan}: escrow of ${formatMoney(escrow)} a month for property tax and insurance (not split between them).`;
  return planNoteDraft("liab", row, ctx, { label: `Plan note: escrow on ${loan}`, topic: "cash-flow", body, columns: ["monthlyEscrow"] });
}

export const LIAB_MAP: SectionMap = {
  sectionId: "liab",
  placements: {
    loanName: { to: "liability.name" },
    type: { to: "liability.liabilityType" },
    owner: { to: "liability.owners" },
    balance: { to: "liability.balance" },
    balanceAsOf: { to: "liability.balanceAsOf" },
    interestRate: { to: "liability.interestRate" },
    monthlyPI: { to: "liability.monthlyPayment" },
    monthlyEscrow: { to: "plan_observation.body" },
    loanStart: { to: "liability.start" },
    termYears: { to: "liability.termMonths" },
    matures: { to: "liability.termMonths" },
    interestDeductible: { to: "liability.isInterestDeductible" },
    propertyName: { to: "liability.linkedPropertyId" },
    ownerEntity: { to: "liability.owners" },
  },
  place(rows, ctx) {
    return rows.flatMap((row): TargetDraft[] => {
      const onRecord = linkedRecord(row, ctx, ["liability"]);
      const recordId = onRecord?.id ?? null;
      const name = text(row, "loanName");
      const label = name ?? onRecord?.label ?? "Loan";
      const b = new DraftBuilder({ sectionId: "liab", row, target: "liability", recordId, label })
        .put("name", name, ["loanName"])
        .put("liabilityType", valueFor(LIABILITY_TYPE_MAP, text(row, "type")), ["type"]);
      putOwners(b, row, ctx, onRecord, "loan");

      const balance = num(row, "balance");
      b.put("balance", balance, ["balance"]);
      putBalanceAsOf(b, row, ctx, balance, onRecord?.values.balance);

      b.put("interestRate", rate(row, "interestRate"), ["interestRate"])
        .put("monthlyPayment", num(row, "monthlyPI"), ["monthlyPI"]);
      placeTerm(b, row, stringOf(onRecord?.values.start), fallbackAsOf(row, ctx));
      b.put("isInterestDeductible", bool(row, "interestDeductible"), ["interestDeductible"]);
      linkProperty(b, row, ctx);

      const note = escrowNote(row, label, ctx);
      return note ? [b.build(), note] : [b.build()];
    });
  },
};
