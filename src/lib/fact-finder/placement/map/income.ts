// src/lib/fact-finder/placement/map/income.ts
/**
 * The Income page (D4): each person's Salary & Wages and Social Security rows,
 * and Other Income rows, → income records; an employer → the household. A
 * Social Security row updates the person's seeded row — it never makes one.
 * "Estimate from salary" is the Social Security dialog's own estimate. Pure.
 */
import { isStatedAge } from "@/lib/social-security/benefit-entry";
import { estimatePiaFromSalary, ownerAnnualSalary } from "@/lib/social-security/estimate-from-salary";
import type { CellRef, PlacedValue } from "../../change-set";
import { INCOME_OWNER_MAP, INCOME_TYPE_MAP, SS_CLAIM_MAP, SS_SOURCE_MAP, TAX_TYPE_MAP, valueFor } from "../../enums";
import { fixedLabelOfRow, fixedRowId } from "../../state";
import type { FFRow } from "../../types";
import { findPerson, hasCoClient, NO_CO_CLIENT_REASON } from "../refs";
import { monthNumber } from "../translate";
import type { BookRecord, TargetDraft } from "../types";
import { cellOf, DraftBuilder, linkedRecordId, num, rate, text } from "./helpers";
import type { PlaceContext, SectionMap } from "./types";

type Role = "client" | "spouse";

/** A missing co-client is fixed on the Household page: the Co-client row's first name. */
const CO_CLIENT_CELL: CellRef = { sectionId: "people", rowId: fixedRowId("people", "Co-client"), columnId: "firstName" };

const LABEL_OF: Record<Role, string> = { client: "Client", spouse: "Co-client" };

/** The person a Client / Co-client row is about: role, and a name for labels (null name: no co-client). */
function personOf(sectionId: string, row: FFRow, ctx: PlaceContext): { role: Role; name: string | null } {
  const role: Role = fixedLabelOfRow(sectionId, row.id) === "Co-client" ? "spouse" : "client";
  const found = findPerson(ctx.refs, LABEL_OF[role], { allow: ["household"] });
  return { role, name: found.ok ? found.label : null };
}

const incomesOf = (ctx: PlaceContext, type: string, role: Role) =>
  ctx.book.records.income.filter((r) => r.facts?.type === type && r.facts?.owner === role);

/** The record the row's confirmed link names, when it's one of `records` — never another kind of income (D11). */
function linkedAmong(row: FFRow, ctx: PlaceContext, records: readonly BookRecord[]): BookRecord | undefined {
  const id = linkedRecordId(row, ctx, ["income"]);
  return records.find((r) => r.id === id);
}

/** A typed year; else, on a new income only, its default — shown on the line, from no cell. */
function putYear(b: DraftBuilder, key: "start" | "end", row: FFRow, columnId: string, fallback: PlacedValue): void {
  const year = num(row, columnId);
  if (year !== null) b.put(key, year, [columnId]);
  else b.put(key, fallback, []);
}

/** A new income with no typed rate grows with inflation, as the Details dialog defaults (the create schema's own default is a flat 3%). */
const INFLATION = { growthSource: "inflation" } as const;

export const SALARY_MAP: SectionMap = {
  sectionId: "salary",
  placements: {
    employer: { to: "client_household.employer" },
    annualSalary: { to: "income.annualAmount" },
    annualRaise: { to: "income.growthRate" },
    startYear: { to: "income.start" },
    endYear: { to: "income.end" },
  },
  place(rows, ctx) {
    return rows.flatMap((row) => {
      const { role, name } = personOf("salary", row, ctx);
      const who = name ?? LABEL_OF[role];
      const drafts: TargetDraft[] = [];

      const employer = text(row, "employer");
      if (employer) {
        const b = new DraftBuilder({ sectionId: "salary", row, target: "client_household", recordId: ctx.book.clientId, label: `Employer — ${who}` })
          .put(role === "client" ? "employer" : "spouseEmployer", employer, ["employer"]);
        if (name === null) b.block(NO_CO_CLIENT_REASON, CO_CLIENT_CELL);
        drafts.push(b.build());
      }

      if (["annualSalary", "annualRaise", "startYear", "endYear"].some((c) => num(row, c) !== null)) {
        const record = linkedAmong(row, ctx, incomesOf(ctx, "salary", role));
        const raise = rate(row, "annualRaise");
        const b = new DraftBuilder({
          sectionId: "salary", row, target: "income", recordId: record?.id ?? null, label: `Salary — ${who}`,
          ...(record ? {} : {
            fixed: { type: "salary", owner: role, name: employer ? `Salary — ${employer}` : "Salary", ...(raise === null ? INFLATION : {}) },
          }),
        })
          .put("annualAmount", num(row, "annualSalary"), ["annualSalary"])
          .put("growthRate", raise, ["annualRaise"], { growthSource: "custom" });
        putYear(b, "start", row, "startYear", record ? null : ctx.year);
        // "End year blank = stops at retirement": the person's retirement, as a milestone.
        putYear(b, "end", row, "endYear", record ? null : { yearRef: `${role}_retirement` });
        if (name === null) b.block(NO_CO_CLIENT_REASON, CO_CLIENT_CELL);
        drafts.push(b.build());
      }
      return drafts;
    });
  },
};

/** This person's salary for "Estimate from salary": the Salary row's, else what's on record (summed as the dialog does). */
function salaryFor(role: Role, ctx: PlaceContext): { amount: number; from: CellRef[] } {
  const row = ctx.state.sections.salary?.find((r) => r.id === fixedRowId("salary", LABEL_OF[role]));
  const typed = row ? num(row, "annualSalary") : null;
  if (row && typed !== null) return { amount: typed, from: [cellOf("salary", row, "annualSalary")] };
  const onRecord = ctx.book.records.income.map((r) => ({
    type: String(r.facts?.type),
    owner: String(r.facts?.owner),
    annualAmount: typeof r.values.annualAmount === "number" ? r.values.annualAmount : null,
    endYear: typeof r.values.end === "number" ? r.values.end : null,
  }));
  return { amount: ownerAnnualSalary(onRecord, role, ctx.year), from: [] };
}

export const SS_MAP: SectionMap = {
  sectionId: "ss",
  placements: {
    benefitSource: { to: "income.ssBenefitMode" },
    monthlyBenefit: { to: "income.piaMonthly" },
    benefitStatedAtAge: { to: "income.ssStatedAge" },
    whenToClaim: { to: "income.claimingAgeMode" },
    claimAgeYears: { to: "income.claimingAge" },
    claimAgeMonths: { to: "income.claimingAgeMonths" },
    cola: { to: "income.growthRate" },
  },
  place(rows, ctx) {
    return rows.map((row) => {
      const { role, name } = personOf("ss", row, ctx);
      const who = name ?? LABEL_OF[role];
      // Every person's row is seeded; the link picks among several, else the only one.
      const mine = incomesOf(ctx, "social_security", role);
      const record = linkedAmong(row, ctx, mine) ?? (mine.length === 1 ? mine[0] : undefined);
      const b = new DraftBuilder({
        sectionId: "ss", row, target: "income", recordId: record?.id ?? null, label: `Social Security — ${who}`,
      });
      if (name === null) b.block(NO_CO_CLIENT_REASON, CO_CLIENT_CELL);
      if (!record) b.block(`This plan has no Social Security row for ${who} — add it in Details.`);

      // The benefit's mode decides where the monthly figure goes; a blank source keeps the record's (NULL reads as a stated benefit).
      const source = valueFor(SS_SOURCE_MAP, text(row, "benefitSource"));
      const stored = record?.values.ssBenefitMode;
      const mode = source === "estimate_from_salary" ? "pia_at_fra" : (source ?? (typeof stored === "string" ? stored : "manual_amount"));
      b.put("ssBenefitMode", source === "estimate_from_salary" ? "pia_at_fra" : source, ["benefitSource"]);
      const monthly = num(row, "monthlyBenefit");
      if (source === "estimate_from_salary") {
        const salary = salaryFor(role, ctx);
        const pia = salary.amount > 0 ? estimatePiaFromSalary(salary.amount) : 0;
        if (pia > 0) b.put("piaMonthly", pia, ["benefitSource", ...salary.from]);
        else b.block("Estimate from salary needs this person's salary.", { sectionId: "salary", rowId: fixedRowId("salary", LABEL_OF[role]), columnId: "annualSalary" });
        if (monthly !== null) b.warn("The monthly benefit isn't used when it's estimated from salary — it wasn't saved.");
      } else if (mode === "pia_at_fra") {
        b.put("piaMonthly", monthly, ["monthlyBenefit"]);
      } else if (mode === "manual_amount") {
        b.put("annualAmount", monthly === null ? null : Math.round(monthly * 1200) / 100, ["monthlyBenefit"], { ssAmountUnit: "monthly" });
      } else if (monthly !== null) {
        b.warn('The monthly benefit isn\'t saved: the benefit is set to "No benefit".');
      }

      const statedAge = num(row, "benefitStatedAtAge");
      if (statedAge !== null && mode !== "manual_amount") b.warn('Benefit stated at age is used only with "Stated benefit at age" — it wasn\'t saved.');
      else if (statedAge !== null && !isStatedAge(statedAge)) b.warn("Benefit stated at age must be 62 to 70 — it wasn't saved.");
      else b.put("ssStatedAge", statedAge, ["benefitStatedAtAge"], { ssStatedAgeMonths: 0 });

      // A claim age is read only with claimingAgeMode "years", so it carries that mode.
      const when = text(row, "whenToClaim");
      const claimMode = valueFor(SS_CLAIM_MAP, when);
      b.put("claimingAgeMode", claimMode, ["whenToClaim"]);
      const years = text(row, "claimAgeYears");
      const months = num(row, "claimAgeMonths");
      if (claimMode !== null && claimMode !== "years" && (years !== null || months !== null)) {
        b.warn(`The claim age isn't saved: When to claim is "${when}".`);
      } else {
        b.put("claimingAge", years === null ? null : Number(years), ["claimAgeYears"], { claimingAgeMode: "years" });
        if (months !== null && (months < 0 || months > 11)) b.warn("Claim age (+ months) must be 0 to 11 — it wasn't saved.");
        else b.put("claimingAgeMonths", months, ["claimAgeMonths"], { claimingAgeMode: "years" });
      }
      b.put("growthRate", rate(row, "cola"), ["cola"], { growthSource: "custom" });
      return b.build();
    });
  },
};

export const INCOME_MAP: SectionMap = {
  sectionId: "income",
  placements: {
    incomeName: { to: "income.name" },
    type: { to: "income.type" },
    owner: { to: "income.owner" },
    annualAmount: { to: "income.annualAmount" },
    annualIncrease: { to: "income.growthRate" },
    startYear: { to: "income.start" },
    endYear: { to: "income.end" },
    taxType: { to: "income.taxType" },
    paidInMonth: { to: "income.paymentMonth" },
    survivorContinues: { to: "income.survivorshipPct" },
  },
  place(rows, ctx) {
    const others = ctx.book.records.income.filter((r) => r.facts?.type !== "salary" && r.facts?.type !== "social_security");
    return rows.map((row) => {
      const record = linkedAmong(row, ctx, others);
      const name = text(row, "incomeName");
      const type = valueFor(INCOME_TYPE_MAP, text(row, "type"));
      const owner = valueFor(INCOME_OWNER_MAP, text(row, "owner"));
      const growth = rate(row, "annualIncrease");
      const month = text(row, "paidInMonth");
      const b = new DraftBuilder({
        sectionId: "income", row, target: "income", recordId: record?.id ?? null, label: name ?? record?.label ?? "Income",
        ...(record || growth !== null ? {} : { fixed: { ...INFLATION } }),
      })
        .put("name", name, ["incomeName"])
        .put("type", type, ["type"])
        .put("owner", owner, ["owner"])
        .put("annualAmount", num(row, "annualAmount"), ["annualAmount"])
        .put("growthRate", growth, ["annualIncrease"], { growthSource: "custom" });
      putYear(b, "start", row, "startYear", record ? null : ctx.year);
      putYear(b, "end", row, "endYear", record ? null : { yearRef: "plan_end" });
      b.put("taxType", valueFor(TAX_TYPE_MAP, text(row, "taxType")), ["taxType"])
        .put("paymentMonth", month === null ? null : monthNumber(month), ["paidInMonth"]);
      if ((owner === "spouse" || owner === "joint") && !hasCoClient(ctx.refs)) b.block(NO_CO_CLIENT_REASON, "owner");

      // Details offers a survivor % only on deferred comp owned by one person; a new income's owner defaults to the client.
      const survivor = rate(row, "survivorContinues");
      const isType = type ?? record?.facts?.type;
      const isOwner = owner ?? record?.facts?.owner ?? "client";
      if (survivor !== null && !(isType === "deferred" && (isOwner === "client" || isOwner === "spouse"))) {
        b.warn("Survivor % applies only to deferred comp owned by one person.");
      } else {
        b.put("survivorshipPct", survivor, ["survivorContinues"]);
      }
      return b.build();
    });
  },
};
