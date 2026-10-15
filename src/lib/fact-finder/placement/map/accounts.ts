// src/lib/fact-finder/placement/map/accounts.ts
/**
 * The Accounts page, part 1 (D4): cash, taxable, retirement and 529 accounts.
 * Each row is one account; a retirement row's beneficiaries are a second line
 * hanging off it. Holdings (not a column) go as the account's positions and
 * never feed its basis. An account the plan manages itself — the household's
 * main checking, a business's own accounts — keeps the owner (and the main
 * checking its type) it has on record. Pure.
 */
import { TRAD_IRA_SUBTYPES } from "@/engine/ira-basis";
import type { PlacedValue } from "../../change-set";
import {
  CASH_TYPE_MAP, PERSON_MAP, RETIRE_TYPE_MAP, SECTION_ACCOUNT_CATEGORY, TAXABLE_TYPE_MAP, TITLING_MAP, valueFor, type OptionMap,
} from "../../enums";
import { last4Of } from "../../identity";
import { holdingValue } from "../../state";
import type { FFHolding, FFRow } from "../../types";
import { findPerson, hasCoClient, householdPerson } from "../refs";
import { str, withLast4 } from "../text";
import type { BookRecord, TargetDraft } from "../types";
import { mergeHoldings } from "../values";
import { beneficiariesOf, bool, DraftBuilder, linkedRecord, num, putOwners, rate, text } from "./helpers";
import type { PlaceContext, SectionMap } from "./types";

type AccountSection = "cash" | "taxable" | "retirement" | "edu";

const UNNAMED: Record<AccountSection, string> = {
  cash: "Cash account", taxable: "Taxable account", retirement: "Retirement account", edu: "529 account",
};
const MANAGED = "The plan manages this account's owner and type.";


/**
 * The account line every row makes — even one whose cells all went elsewhere,
 * so a value that didn't fit its column always has a line to block. Name,
 * value, last 4 and custodian are common to the four sections.
 */
function startAccount(sectionId: AccountSection, row: FFRow, ctx: PlaceContext, fixed: Record<string, PlacedValue>) {
  const record = linkedRecord(row, ctx, ["account"]);
  const recordId = record?.id ?? null;
  const name = text(row, "accountName");
  const l4 = last4Of(text(row, "last4"));
  const label = name !== null ? withLast4(name, l4) : (record?.label ?? withLast4(UNNAMED[sectionId], l4));
  const b = new DraftBuilder({ sectionId, row, target: "account", recordId, label, fixed })
    .put("name", name, ["accountName"])
    .put("value", num(row, "currentValue"), ["currentValue"])
    .put("accountNumberLast4", l4 || null, ["last4"])
    .put("custodian", text(row, "custodian"), ["custodian"]);
  return { b, record, label };
}

/**
 * Account type, then Owner (+ "Which trust / entity"). The household's main
 * checking and every business "— Cash" account (`isDefaultChecking`) keep their
 * owner and type — the account write path refuses both; a business's own
 * account (`parentAccountId`) is owned through the business.
 */
function putTypeAndOwners(b: DraftBuilder, row: FFRow, ctx: PlaceContext, record: BookRecord | undefined, types: OptionMap): void {
  const managed = record?.facts?.isDefaultChecking === true;
  const type = valueFor(types, text(row, "accountType"));
  if (type !== null && managed) b.warn(MANAGED);
  else b.put("subType", type, ["accountType"]);

  if (!managed) putOwners(b, row, ctx, record, "account");
  else if (text(row, "owner") !== null) b.warn(MANAGED);
}

/** The client and the co-client own the account on record. */
function jointOnRecord(record: BookRecord | undefined): boolean {
  const owners = record?.values.owners;
  const roles = (Array.isArray(owners) ? owners : []).map((o) => {
    const who = (o as { who?: { ref?: string; role?: string } } | null)?.who;
    return who?.ref === "person" ? who.role : null;
  });
  return roles.includes("client") && roles.includes("spouse");
}

/** Joint titling means something only on a joint account: the row's Owner, else the owners on record. */
function putTitling(b: DraftBuilder, row: FFRow, record: BookRecord | undefined): void {
  const titling = valueFor(TITLING_MAP, text(row, "jointTitling"));
  if (titling === null) return;
  const owner = text(row, "owner");
  if (owner === "Joint" || (owner === null && jointOnRecord(record))) b.put("titlingType", titling, ["jointTitling"]);
  else b.warn("Joint titling applies only to a joint account.");
}

/** A position as the book holds it: with no market value, it is worth shares × price (to the cent). */
function positionOf(h: FFHolding): PlacedValue {
  return { ticker: h.ticker, name: h.name, shares: h.shares, price: h.price, marketValue: holdingValue(h), costBasis: h.costBasis };
}

/**
 * The row's holdings merged into the account's positions on record (no cell: holdings aren't a column) — one it
 * doesn't list stays. A position's cost basis stays on the position.
 */
function putHoldings(b: DraftBuilder, row: FFRow, record: BookRecord | undefined): void {
  const positions = (row.holdings ?? []).map(positionOf);
  const held = record?.values.holdings;
  b.put("holdings", positions.length > 0 ? mergeHoldings(positions, held) : [], []);
  if (positions.length === 0 || (Array.isArray(held) && held.length > 0)) return;
  b.warn(
    positions.length === 1
      ? "Saving this position makes this account take its value from it."
      : `Saving these ${positions.length} positions makes this account take its value from them.`,
  );
}

export const CASH_MAP: SectionMap = {
  sectionId: "cash",
  placements: {
    accountName: { to: "account.name" },
    currentValue: { to: "account.value" },
    last4: { to: "account.accountNumberLast4" },
    owner: { to: "account.owners" },
    jointTitling: { to: "account.titlingType" },
    custodian: { to: "account.custodian" },
    accountType: { to: "account.subType" },
    interestRate: { to: "account.growthRate" },
    ownerEntity: { to: "account.owners" },
  },
  place(rows, ctx) {
    return rows.map((row): TargetDraft => {
      const { b, record } = startAccount("cash", row, ctx, { category: SECTION_ACCOUNT_CATEGORY.cash });
      putTypeAndOwners(b, row, ctx, record, CASH_TYPE_MAP);
      putTitling(b, row, record);
      b.put("growthRate", rate(row, "interestRate"), ["interestRate"], { growthSource: "custom" });
      return b.build();
    });
  },
};

export const TAXABLE_MAP: SectionMap = {
  sectionId: "taxable",
  placements: {
    accountName: { to: "account.name" },
    currentValue: { to: "account.value" },
    costBasis: { to: "account.basis" },
    last4: { to: "account.accountNumberLast4" },
    owner: { to: "account.owners" },
    jointTitling: { to: "account.titlingType" },
    custodian: { to: "account.custodian" },
    accountType: { to: "account.subType" },
    ownerEntity: { to: "account.owners" },
  },
  place(rows, ctx) {
    return rows.map((row): TargetDraft => {
      const { b, record } = startAccount("taxable", row, ctx, { category: SECTION_ACCOUNT_CATEGORY.taxable });
      // "Trust" under Account type is a sub-type (a trust account), never an owner.
      putTypeAndOwners(b, row, ctx, record, TAXABLE_TYPE_MAP);
      putTitling(b, row, record);
      b.put("basis", num(row, "costBasis"), ["costBasis"]);
      putHoldings(b, row, record);
      return b.build();
    });
  },
};

/** A retirement account's beneficiary tiers, and the columns that fill them. */
const TIERS = [["primary", "primaryBeneficiary"], ["contingent", "contingentBeneficiary"]] as const;

/** Roth portion, after-tax basis and an inheritance, each by the account's type (the row's, else the record's). */
function putRetirement(b: DraftBuilder, row: FFRow, record: BookRecord | undefined): void {
  const type = valueFor(RETIRE_TYPE_MAP, text(row, "accountType")) ?? str(record?.facts?.subType);

  const roth = num(row, "rothPortion");
  if (roth !== null) {
    if (type === "401k" || type === "403b") b.put("rothValue", roth, ["rothPortion"]);
    else b.warn("Roth portion applies only to a 401(k) or 403(b).");
  }

  // After-tax (Form 8606) basis — the same `basis` column as a taxable account's cost basis. Only the
  // IRAs in the engine's 8606 pool use it (field map: "leave 0 for 401k/403b/Roth").
  const afterTax = num(row, "afterTaxBasis");
  if (afterTax !== null) {
    if (type !== null && TRAD_IRA_SUBTYPES.has(type)) b.put("basis", afterTax, ["afterTaxBasis"]);
    else b.warn("After-tax basis applies only to a traditional, SEP or SIMPLE IRA.");
  }

  // Spec § 8: the app knows an inherited IRA by the original owner's two years, on a Traditional or Roth IRA only.
  const born = num(row, "originalOwnerBirthYear");
  const died = num(row, "originalOwnerDeathYear");
  if (bool(row, "inherited") === true) {
    if (born !== null && died !== null && (type === "traditional_ira" || type === "roth_ira")) {
      b.put("inheritedOwnerBirthYear", born, ["inherited", "originalOwnerBirthYear"]);
      b.put("inheritedDeathYear", died, ["inherited", "originalOwnerDeathYear"]);
    } else {
      b.warn("To save the inheritance, add the original owner's birth year and year of death (Traditional or Roth IRA only).");
    }
  } else if (born !== null || died !== null) {
    b.warn('The original owner\'s years are saved only when Inherited? is "Yes".');
  }

  b.put("priorYearEndValue", num(row, "priorYearEndValue"), ["priorYearEndValue"]);
}

export const RETIREMENT_MAP: SectionMap = {
  sectionId: "retirement",
  placements: {
    accountName: { to: "account.name" },
    currentValue: { to: "account.value" },
    rothPortion: { to: "account.rothValue" },
    afterTaxBasis: { to: "account.basis" },
    last4: { to: "account.accountNumberLast4" },
    owner: { to: "account.owners" },
    custodian: { to: "account.custodian" },
    accountType: { to: "account.subType" },
    inherited: { to: "account.inheritedDeathYear" },
    priorYearEndValue: { to: "account.priorYearEndValue" },
    primaryBeneficiary: { to: "account_beneficiary_designation.beneficiaries" },
    contingentBeneficiary: { to: "account_beneficiary_designation.beneficiaries" },
    originalOwnerBirthYear: { to: "account.inheritedOwnerBirthYear" },
    originalOwnerDeathYear: { to: "account.inheritedDeathYear" },
  },
  place(rows, ctx) {
    return rows.flatMap((row): TargetDraft[] => {
      const { b, record, label } = startAccount("retirement", row, ctx, { category: SECTION_ACCOUNT_CATEGORY.retirement });
      putTypeAndOwners(b, row, ctx, record, RETIRE_TYPE_MAP);
      putRetirement(b, row, record);
      putHoldings(b, row, record);
      const names = beneficiariesOf(b, row, ctx, {
        target: "account_beneficiary_designation", tiers: TIERS, recordId: record?.id ?? null, label,
        newWarning: "These beneficiaries replace the default beneficiaries a new retirement account gets.",
      });
      return names ? [b.build(), names] : [b.build()];
    });
  },
};

/**
 * A 529's student or funder: the client, the co-client or a family member, else
 * the name as written (someone outside the household — a grandparent). Two
 * matches, or a co-client the plan doesn't have, can't save.
 */
function personOrName(ctx: PlaceContext, name: string): { ok: true; value: PlacedValue } | { ok: false; reason: string } {
  const found = findPerson(ctx.refs, name, { allow: ["household", "family"] });
  if (found.ok) return { ok: true, value: found.ref };
  return found.reason.startsWith("No one named") ? { ok: true, value: name } : found;
}

/** Grantor, else (spec § 8) the Owner fills a blank grantor: Client or Co-client is that person; a 529 itself has no owner on the plan. */
function putGrantor(b: DraftBuilder, row: FFRow, ctx: PlaceContext, record: BookRecord | undefined): void {
  const grantor = text(row, "grantor");
  if (grantor !== null) {
    const funder = personOrName(ctx, grantor);
    if (!funder.ok) b.block(funder.reason, "grantor");
    else b.put("grantor", funder.value, ["grantor"]);
    return;
  }
  // A Grantor that didn't read named someone: the Owner never stands in for it.
  if (ctx.removed(row.id, "grantor")) return;
  const owner = text(row, "owner");
  const onRecord = record?.values.grantor;
  if (owner === null || (onRecord !== undefined && onRecord !== null && onRecord !== "")) return;
  const role = valueFor(PERSON_MAP, owner);
  if (role === "client" || (role === "spouse" && hasCoClient(ctx.refs))) b.put("grantor", householdPerson(role), ["owner"]);
  else b.warn("A 529 has no owner on the plan — pick who funded it under Grantor.");
}

export const EDU_MAP: SectionMap = {
  sectionId: "edu",
  placements: {
    accountName: { to: "account.name" },
    currentValue: { to: "account.value" },
    basis: { to: "account.basis" },
    last4: { to: "account.accountNumberLast4" },
    owner: { to: "account.grantor" },
    custodian: { to: "account.custodian" },
    beneficiary: { to: "account.beneficiary" },
    grantor: { to: "account.grantor" },
  },
  place(rows, ctx) {
    return rows.map((row): TargetDraft => {
      // A new 529's sub-type is "529", the only one the Details dialog offers for the category.
      const { b, record } = startAccount("edu", row, ctx, { category: SECTION_ACCOUNT_CATEGORY.edu, subType: "529" });
      b.put("basis", num(row, "basis"), ["basis"]);
      const student = text(row, "beneficiary");
      if (student !== null) {
        const found = personOrName(ctx, student);
        if (!found.ok) b.block(found.reason, "beneficiary");
        else b.put("beneficiary", found.value, ["beneficiary"]);
      } else if (record === undefined) {
        b.block("A 529 needs its beneficiary (the student).", "beneficiary");
      }
      putGrantor(b, row, ctx, record);
      putHoldings(b, row, record);
      return b.build();
    });
  },
};
