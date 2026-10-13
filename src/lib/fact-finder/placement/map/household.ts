// src/lib/fact-finder/placement/map/household.ts
/**
 * The Household page: Prepared for (context only), the client and co-client,
 * the household's filing status and address, family members, and charities &
 * other beneficiaries. The Client, Co-client and Household rows all update the
 * one household record (the client) and the base case's tax settings. Pure.
 */
import type { PlacedValue } from "../../change-set";
import { BENE_KIND_MAP, CHARITY_TYPE_MAP, DEPENDENT_MAP, FILING_MAP, RELATIONSHIP_MAP, valueFor } from "../../enums";
import { fixedLabelOfRow } from "../../state";
import type { FFRow } from "../../types";
import { hasCoClient } from "../refs";
import { monthNumber } from "../translate";
import type { TargetDraft } from "../types";
import { bool, DraftBuilder, linkedRecordId, num, text } from "./helpers";
import type { PlaceContext, SectionMap } from "./types";

const NO_PLAN_SETTINGS = "This plan has no plan settings yet.";
const NEEDS_CO_CLIENT_NAME = "Add the co-client's first name — it's needed to add a co-client.";

/** The base case's tax settings record; null when the client has no base case yet. */
const planSettingsId = (ctx: PlaceContext) => ctx.book.records.plan_settings_tax_rates[0]?.id ?? null;

/** A line needs something to write: a row's values may all belong to the other target. */
const withFields = (drafts: TargetDraft[]) => drafts.filter((d) => d.fields.length > 0);

const month = (row: FFRow, columnId: string) => {
  const label = text(row, columnId);
  return label === null ? null : monthNumber(label);
};

export const META_MAP: SectionMap = {
  sectionId: "meta",
  placements: {
    preparedFor: { context: "The household's name follows the client's and co-client's names." },
    advisor: { context: "The advisor is whoever is signed in." },
    dateCompleted: { context: "The 'as of' date for values with no statement date." },
  },
  place: () => [],
};

/** Client & Co-client columns → the household key for the Client row and for the Co-client row. */
const PERSON_FIELDS: readonly [columnId: string, client: string, spouse: string, read: (row: FFRow, columnId: string) => PlacedValue][] = [
  ["firstName", "firstName", "spouseName", text],
  ["lastName", "lastName", "spouseLastName", text],
  ["dateOfBirth", "dateOfBirth", "spouseDob", text],
  ["retirementAge", "retirementAge", "spouseRetirementAge", num],
  ["retirementMonth", "retirementMonth", "spouseRetirementMonth", month],
  ["planToAge", "lifeExpectancy", "spouseLifeExpectancy", num],
  ["email", "email", "spouseEmail", text],
  ["phone", "phone", "spousePhone", text],
  ["mobile", "mobile", "spouseMobile", text],
];

/** "Mark Hendricks": the row's names, else the ones on record. */
function personName(ctx: PlaceContext, row: FFRow, role: "client" | "spouse"): string | null {
  const onRecord = ctx.book.records.client_household[0]?.values[role === "client" ? "lastName" : "spouseLastName"];
  const first = text(row, "firstName") ?? ctx.book.names[role];
  const last = text(row, "lastName") ?? (typeof onRecord === "string" ? onRecord : null);
  return first ? [first, last].filter(Boolean).join(" ") : null;
}

export const PEOPLE_MAP: SectionMap = {
  sectionId: "people",
  // The Co-client row's values go to the same targets' co-client keys (spouseName, spouseDob…).
  placements: {
    firstName: { to: "client_household.firstName" },
    lastName: { to: "client_household.lastName" },
    dateOfBirth: { to: "client_household.dateOfBirth" },
    retirementAge: { to: "client_household.retirementAge" },
    retirementMonth: { to: "client_household.retirementMonth" },
    planToAge: { to: "client_household.lifeExpectancy" },
    email: { to: "client_household.email" },
    phone: { to: "client_household.phone" },
    mobile: { to: "client_household.mobile" },
    coveredByWorkplacePlan: { to: "plan_settings_tax_rates.coveredByWorkplacePlan" },
  },
  place(rows, ctx) {
    return rows.flatMap((row) => {
      const rowLabel = fixedLabelOfRow("people", row.id);
      const role = rowLabel === "Client" ? "client" : rowLabel === "Co-client" ? "spouse" : null;
      if (!rowLabel || !role) return [];
      const name = personName(ctx, row, role);

      // Always an update: the household record is the client (a blank never erases, so a
      // blank Co-client first name never sends the empty spouseName that would remove the co-client).
      const household = new DraftBuilder({
        sectionId: "people", row, target: "client_household", recordId: ctx.book.clientId,
        label: name ? `${rowLabel} — ${name}` : rowLabel,
      });
      for (const [columnId, clientKey, spouseKey, read] of PERSON_FIELDS) {
        household.put(role === "client" ? clientKey : spouseKey, read(row, columnId), [columnId]);
      }

      const covered = bool(row, "coveredByWorkplacePlan");
      const settings = new DraftBuilder({
        sectionId: "people", row, target: "plan_settings_tax_rates", recordId: planSettingsId(ctx),
        label: name ? `Tax settings — ${name}` : "Tax settings",
      }).put(
        role === "client" ? "coveredByWorkplacePlan" : "spouseCoveredByWorkplacePlan",
        covered === null ? null : covered ? "yes" : "no",          // blank stays "auto" on record
        ["coveredByWorkplacePlan"],
      );

      if (role === "spouse" && text(row, "firstName") === null && !hasCoClient(ctx.refs)) {
        household.block(NEEDS_CO_CLIENT_NAME, "firstName");
        settings.block(NEEDS_CO_CLIENT_NAME, "firstName");
      }
      if (planSettingsId(ctx) === null) settings.block(NO_PLAN_SETTINGS, "coveredByWorkplacePlan");
      return withFields([household.build(), settings.build()]);
    });
  },
};

export const HOUSEHOLD_MAP: SectionMap = {
  sectionId: "household",
  placements: {
    filingStatus: { to: "client_household.filingStatus" },
    stateOfResidence: { to: "plan_settings_tax_rates.residenceState" },
    street: { to: "client_household.addressLine1" },
    address2: { to: "client_household.addressLine2" },
    city: { to: "client_household.city" },
    state: { to: "client_household.state" },
    zip: { to: "client_household.postalCode" },
  },
  place(rows, ctx) {
    return rows.flatMap((row) => {
      const household = new DraftBuilder({ sectionId: "household", row, target: "client_household", recordId: ctx.book.clientId, label: "Household" })
        .put("filingStatus", valueFor(FILING_MAP, text(row, "filingStatus")), ["filingStatus"])
        .put("addressLine1", text(row, "street"), ["street"])
        .put("addressLine2", text(row, "address2"), ["address2"])
        .put("city", text(row, "city"), ["city"])
        .put("state", text(row, "state"), ["state"])                  // the mailing address's state (a USPS code)
        .put("postalCode", text(row, "zip"), ["zip"]);
      // The state the tax engine reads; not the address's state.
      const settings = new DraftBuilder({
        sectionId: "household", row, target: "plan_settings_tax_rates", recordId: planSettingsId(ctx), label: "Tax settings",
      }).put("residenceState", text(row, "stateOfResidence"), ["stateOfResidence"]);
      if (planSettingsId(ctx) === null) settings.block(NO_PLAN_SETTINGS, "stateOfResidence");
      return withFields([household.build(), settings.build()]);
    });
  },
};

export const FAMILY_MAP: SectionMap = {
  sectionId: "family",
  placements: {
    firstName: { to: "family_member.firstName" },
    lastName: { to: "family_member.lastName" },
    relationship: { to: "family_member.relationship" },
    dateOfBirth: { to: "family_member.dateOfBirth" },
    claimedAsDependent: { to: "family_member.claimedAsDependent" },
    domesticPartner: { to: "family_member.domesticPartner" },
    notes: { to: "family_member.notes" },
  },
  place(rows, ctx) {
    return rows.map((row) => {
      const first = text(row, "firstName");
      const last = text(row, "lastName");
      // A missing first name is left to validation (Task 17), which names the column.
      return new DraftBuilder({
        sectionId: "family", row, target: "family_member", recordId: linkedRecordId(row, ctx, ["family_member"]),
        label: [first, last].filter(Boolean).join(" ") || "Family member",
      })
        .put("firstName", first, ["firstName"])
        .put("lastName", last, ["lastName"])
        .put("relationship", valueFor(RELATIONSHIP_MAP, text(row, "relationship")), ["relationship"])
        .put("dateOfBirth", text(row, "dateOfBirth"), ["dateOfBirth"])
        .put("claimedAsDependent", valueFor(DEPENDENT_MAP, text(row, "claimedAsDependent")), ["claimedAsDependent"])
        .put("domesticPartner", bool(row, "domesticPartner"), ["domesticPartner"])
        .put("notes", text(row, "notes"), ["notes"])
        .build();
    });
  },
};

export const EXTERNAL_MAP: SectionMap = {
  sectionId: "external",
  placements: {
    name: { to: "external_beneficiary.name" },
    kind: { to: "external_beneficiary.kind" },
    charityType: { to: "external_beneficiary.charityType" },
    notes: { to: "external_beneficiary.notes" },
  },
  place(rows, ctx) {
    return rows.map((row) => {
      const recordId = linkedRecordId(row, ctx, ["external_beneficiary"]);
      const kind = valueFor(BENE_KIND_MAP, text(row, "kind"));
      const b = new DraftBuilder({
        sectionId: "external", row, target: "external_beneficiary", recordId, label: text(row, "name") ?? "Charity or beneficiary",
      })
        .put("name", text(row, "name"), ["name"])
        .put("kind", kind, ["kind"]);
      // The row's kind, else the record's; a new beneficiary with no kind saves as a charity.
      const kindOnRecord = ctx.book.records.external_beneficiary.find((r) => r.id === recordId)?.values.kind;
      const charityType = valueFor(CHARITY_TYPE_MAP, text(row, "charityType"));
      if (charityType && (kind ?? kindOnRecord) === "individual") b.warn("Charity type applies only to a charity.");
      else b.put("charityType", charityType, ["charityType"]);
      return b.put("notes", text(row, "notes"), ["notes"]).build();
    });
  },
};
