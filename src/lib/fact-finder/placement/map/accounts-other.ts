// src/lib/fact-finder/placement/map/accounts-other.ts
/**
 * Section maps for the rest of the Accounts page (D4): annuities (an account
 * and its contract), stock options (one account per company and holder, one
 * grant per row) and notes receivable. Pure.
 */
import type { PlacedValue, RecordRef } from "../../change-set";
import {
  ANNUITY_INCOME_MAP, ANNUITY_PAYOUT_MAP, ANNUITY_PRODUCT_MAP, ANNUITY_TAX_MAP, GRANT_TYPE_MAP, labelFor, NOTE_PAY_MAP,
  PERSON_MAP, SECTION_ACCOUNT_CATEGORY, valueFor,
} from "../../enums";
import { last4Of, normText } from "../../identity";
import type { FFRow } from "../../types";
import { hasCoClient, NO_CO_CLIENT_REASON } from "../refs";
import type { BookRecord, TargetDraft } from "../types";
import { cellOf, DraftBuilder, linkedRecordId, num, ownersOf, rate, text } from "./helpers";
import type { PlaceContext, SectionMap } from "./types";
import { parseVestingSchedule } from "./vesting";

export const ANNUITY_INCOME_WARNING =
  "Income from a rider or annuitization isn't saved — the fact finder doesn't ask the benefit base or the payment. Set it in Details.";

const ownerColumns = (row: FFRow) => (text(row, "owner") === "Trust / entity" ? ["owner", "ownerEntity"] : ["owner"]);
const str = (v: PlacedValue | undefined) => (typeof v === "string" ? v : null);
const numberOf = (v: PlacedValue | undefined) => (typeof v === "number" ? v : null);

export const ANNUITY_MAP: SectionMap = {
  sectionId: "annuity",
  placements: {
    contractName: { to: "account.name" },
    cashValue: { to: "account.value" },
    costBasis: { to: "annuity_contract.costBasis" },
    last4: { to: "account.accountNumberLast4" },
    owner: { to: "account.owners" },
    carrier: { to: "account.custodian" },
    taxTreatment: { to: "account.subType" },
    productType: { to: "annuity_contract.productType" },
    income: { to: "annuity_contract.incomeMode" },
    payoutStructure: { to: "annuity_contract.payoutStructure" },
    ownerEntity: { to: "account.owners" },
  },
  place(rows, ctx) {
    return rows.flatMap((row): TargetDraft[] => {
      const name = text(row, "contractName");
      const l4 = last4Of(text(row, "last4"));
      const label = [name ?? "Annuity", l4 && `··${l4}`].filter(Boolean).join(" ");
      const recordId = linkedRecordId(row, ctx, ["account"]);
      const account = new DraftBuilder({
        sectionId: "annuity", row, target: "account", recordId, label,
        fixed: { category: SECTION_ACCOUNT_CATEGORY.annuity },
      })
        .put("name", name, ["contractName"])
        .put("value", num(row, "cashValue"), ["cashValue"])
        .put("accountNumberLast4", l4 || null, ["last4"])
        .put("custodian", text(row, "carrier"), ["carrier"])
        .put("subType", valueFor(ANNUITY_TAX_MAP, text(row, "taxTreatment")), ["taxTreatment"]);
      const owners = ownersOf("annuity", row, ctx);
      if (!owners.ok) account.block(owners.reason, owners.columnId);
      else account.put("owners", owners.owners, ownerColumns(row));

      // The contract is keyed by its account: an update only when this account already has one.
      const hasContract = recordId !== null && ctx.book.records.annuity_contract.some((r) => r.id === recordId);
      const contract = new DraftBuilder({
        sectionId: "annuity", row, target: "annuity_contract", recordId: hasContract ? recordId : null,
        label: `${label} — contract`, parent: account.ref,
      })
        .put("costBasis", num(row, "costBasis"), ["costBasis"])   // never accounts.basis; blank stays unknown
        .put("productType", valueFor(ANNUITY_PRODUCT_MAP, text(row, "productType")), ["productType"]);
      const income = valueFor(ANNUITY_INCOME_MAP, text(row, "income"));
      if (income === "none") contract.put("incomeMode", income, ["income"]);
      else if (income !== null) contract.warn(ANNUITY_INCOME_WARNING);
      contract.put("payoutStructure", valueFor(ANNUITY_PAYOUT_MAP, text(row, "payoutStructure")), ["payoutStructure"]);

      const built = contract.build();
      if (built.fields.length > 0) return [account.build(), built];
      // No contract values: no empty contract write — its warnings go on the account.
      for (const warning of built.warnings) account.warn(warning);
      return [account.build()];
    });
  },
};

const holderOf = (row: FFRow) => valueFor(PERSON_MAP, text(row, "owner"));

/** The stock option account a row's linked grant sits in (the book's grant `facts.accountId`). */
function accountOfLinkedGrant(rows: readonly FFRow[], ctx: PlaceContext): string | null {
  for (const row of rows) {
    const grantId = linkedRecordId(row, ctx, ["stock_option_grant"]);
    const accountId = ctx.book.records.stock_option_grant.find((r) => r.id === grantId)?.facts?.accountId;
    if (typeof accountId === "string" && ctx.book.records.stock_option_account.some((r) => r.id === accountId)) return accountId;
  }
  return null;
}

/** The plan's one stock option account with this company name (and holder, when known) — D8. */
function accountByName(company: string, holder: string | null, ctx: PlaceContext): string | null {
  const hits = ctx.book.records.stock_option_account.filter(
    (r) => normText(str(r.values.name)) === normText(company) && (holder === null || r.values.owner == null || r.values.owner === holder),
  );
  return hits.length === 1 ? hits[0].id : null;
}

/** The shares of a grant's vest rows on record; null when it has none. */
function vestedOnRecord(grant: BookRecord): number | null {
  const rows = grant.values.tranches;
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return rows.reduce<number>((sum, t) => sum + (numberOf((t as { shares?: PlacedValue }).shares) ?? 0), 0);
}

function grantDraft(row: FFRow, account: RecordRef | undefined, ctx: PlaceContext): TargetDraft {
  const recordId = linkedRecordId(row, ctx, ["stock_option_grant"]);
  const onRecord = ctx.book.records.stock_option_grant.find((r) => r.id === recordId);
  // A grant on record stays under its own account (the update route is keyed by it).
  const ownAccount = str(onRecord?.facts?.accountId);
  const parent: RecordRef | undefined = ownAccount ? { ref: "record", target: "stock_option_account", id: ownAccount } : account;
  const type = text(row, "grantType");
  const grantNumber = text(row, "grantNumber");
  const grantDate = text(row, "grantDate");
  const sharesGranted = num(row, "sharesGranted");
  const label = [text(row, "company") ?? "Stock option", type, "grant", grantNumber && `#${grantNumber}`].filter(Boolean).join(" ");
  const b = new DraftBuilder({ sectionId: "equity", row, target: "stock_option_grant", recordId, label, ...(parent ? { parent } : {}) })
    .put("grantType", valueFor(GRANT_TYPE_MAP, type), ["grantType"])
    .put("grantNumber", grantNumber, ["grantNumber"])
    .put("grantDate", grantDate, ["grantDate"])
    .put("sharesGranted", sharesGranted, ["sharesGranted"])
    .put("strikePrice", num(row, "strikePrice"), ["strikePrice"])
    .put("expirationDate", text(row, "expirationDate"), ["expirationDate"]);
  if (!parent) b.block("Add the company or plan these grants are from.", "company");

  const schedule = text(row, "vestingSchedule");
  if (schedule !== null) {
    const vesting = parseVestingSchedule(schedule, {
      grantDate: grantDate ?? str(onRecord?.values.grantDate),
      sharesGranted: sharesGranted ?? numberOf(onRecord?.values.sharesGranted),
    });
    if (vesting.ok) b.put("tranches", vesting.tranches, ["vestingSchedule"]);
    else b.block(vesting.reason, "vestingSchedule");
  } else if (onRecord && sharesGranted !== null) {
    // The vest rows on record must still add up to the shares granted, or the grant can't save.
    const vested = vestedOnRecord(onRecord);
    if (vested !== null && Math.abs(vested - sharesGranted) > 1e-6) {
      b.block(`Shares granted changed to ${sharesGranted.toLocaleString("en-US")} — add the vesting schedule so the vest dates add up to it.`, "vestingSchedule");
    }
  }
  return b.build();
}

export const EQUITY_MAP: SectionMap = {
  sectionId: "equity",
  placements: {
    company: { to: "stock_option_account.name" },
    ticker: { to: "stock_option_account.ticker" },
    grantType: { to: "stock_option_grant.grantType" },
    grantNumber: { to: "stock_option_grant.grantNumber" },
    grantDate: { to: "stock_option_grant.grantDate" },
    sharesGranted: { to: "stock_option_grant.sharesGranted" },
    strikePrice: { to: "stock_option_grant.strikePrice" },
    expirationDate: { to: "stock_option_grant.expirationDate" },
    vestingSchedule: { to: "stock_option_grant.tranches" },
    owner: { to: "stock_option_account.owner" },
  },
  place(rows, ctx) {
    // One account per company and holder (an account has one owner); a blank Owner joins the company's only holder.
    const groups = new Map<string, { company: string; holder: string | null; split: boolean; rows: FFRow[] }>();
    for (const row of rows) {
      const company = text(row, "company");
      if (company === null) continue;
      const holders = new Set(rows.filter((r) => normText(text(r, "company")) === normText(company)).map(holderOf).filter(Boolean));
      const holder = holderOf(row) ?? (holders.size === 1 ? [...holders][0] : null);
      const key = `${normText(company)}|${holder ?? ""}`;
      const group = groups.get(key) ?? { company, holder, split: holders.size > 1, rows: [] };
      group.rows.push(row);
      groups.set(key, group);
    }

    const drafts: TargetDraft[] = [];
    for (const { company, holder, split, rows: group } of groups.values()) {
      const [first] = group;
      const recordId = accountOfLinkedGrant(group, ctx) ?? accountByName(company, holder, ctx);
      const label = split ? `${company} — ${labelFor(PERSON_MAP, holder) ?? "Owner not given"}` : company;
      const account = new DraftBuilder({ sectionId: "equity", row: first, target: "stock_option_account", recordId, label })
        .put("name", company, ["company"]);
      const withTicker = group.find((r) => text(r, "ticker") !== null);
      if (withTicker) account.put("ticker", text(withTicker, "ticker"), [cellOf("equity", withTicker, "ticker")]);
      const withOwner = group.find((r) => holderOf(r) !== null);
      if (withOwner) {
        const cell = cellOf("equity", withOwner, "owner");
        if (holder === "spouse" && !hasCoClient(ctx.refs)) account.block(NO_CO_CLIENT_REASON, cell);
        else account.put("owner", holder, [cell]);
      } else if (recordId === null) {
        account.block("Pick who holds these grants.", "owner");
      }
      drafts.push(account.build(), ...group.map((row) => grantDraft(row, account.ref, ctx)));
    }
    // A grant with no company has no account to go under — unless it's on record.
    for (const row of rows) if (text(row, "company") === null) drafts.push(grantDraft(row, undefined, ctx));
    return drafts;
  },
};

export const NOTES_REC_MAP: SectionMap = {
  sectionId: "notes_rec",
  placements: {
    borrower: { to: "note_receivable.name" },
    originalAmount: { to: "note_receivable.faceValue" },
    currentBalance: { to: "note_receivable.asOfBalance" },
    balanceAsOf: { to: "note_receivable.balanceAsOf" },
    interestRate: { to: "note_receivable.interestRate" },
    paymentType: { to: "note_receivable.paymentType" },
    monthlyPayment: { to: "note_receivable.monthlyPayment" },
    start: { to: "note_receivable.start" },
    termMonths: { to: "note_receivable.termMonths" },
    owner: { to: "note_receivable.owners" },
    ownerEntity: { to: "note_receivable.owners" },
  },
  place(rows, ctx) {
    return rows.map((row): TargetDraft => {
      const recordId = linkedRecordId(row, ctx, ["note_receivable"]);
      const name = text(row, "borrower");
      const faceValue = num(row, "originalAmount");
      const balance = num(row, "currentBalance");
      const b = new DraftBuilder({ sectionId: "notes_rec", row, target: "note_receivable", recordId, label: name ?? "Note receivable" })
        .put("name", name, ["borrower"])
        .put("faceValue", faceValue, ["originalAmount"])
        // A new note needs a basis, which the fact finder doesn't ask: the face value (lower only for an installment sale).
        .put("basis", recordId === null ? faceValue : null, ["originalAmount"])
        .put("asOfBalance", balance, ["currentBalance"]);

      const asOf = text(row, "balanceAsOf");
      const held = numberOf(ctx.book.records.note_receivable.find((r) => r.id === recordId)?.values.asOfBalance);
      if (asOf !== null) b.put("balanceAsOf", asOf, ["balanceAsOf"]);
      // An undated new balance is as of its statement, else the date the fact finder was completed.
      else if (balance !== null && (held === null || Math.abs(held - balance) >= 0.005)) {
        b.put("balanceAsOf", (row.statementDate ?? ctx.asOf)?.slice(0, 7), []);
      }

      b.put("interestRate", rate(row, "interestRate"), ["interestRate"])
        .put("paymentType", valueFor(NOTE_PAY_MAP, text(row, "paymentType")), ["paymentType"])
        .put("monthlyPayment", num(row, "monthlyPayment"), ["monthlyPayment"])
        .put("start", text(row, "start"), ["start"])
        .put("termMonths", num(row, "termMonths"), ["termMonths"]);
      const owners = ownersOf("notes_rec", row, ctx);
      if (!owners.ok) b.block(owners.reason, owners.columnId);
      else if (owners.owners.length > 0) b.put("owners", owners.owners, ownerColumns(row));
      else if (recordId === null) b.block("Pick who the note belongs to.", "owner");
      return b.build();
    });
  },
};
