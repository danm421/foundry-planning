import { buildHouseholdName } from "@/lib/crm/household-name";
import type { CreateCrmContactInput, ImportHouseholdInput } from "@/lib/crm/schemas";
import {
  FIELD_LABELS,
  REQUIRED_FIELDS,
  type ColumnMapping,
  type ImportField,
} from "./columns";
import {
  clampText,
  parseEmail,
  parseImportDate,
  parseState,
  parseStatus,
} from "./coerce";

/**
 * Turn a raw grid plus a column mapping into importable rows.
 *
 * PURE + CLIENT-SAFE. The single rule: a row dies only when the primary's
 * first or last name is missing. Everything else degrades to a warning, so an
 * advisor never loses a client over a malformed phone number.
 */

export const MAX_IMPORT_ROWS = 1000;

// Column limits from crm_households / crm_household_contacts. Over-long cells
// are clamped with a warning rather than 400ing the commit.
const MAX_NAME = 100;
const MAX_HOUSEHOLD_NAME = 200;
const MAX_NOTES = 5000;
const MAX_PHONE = 40;
const MAX_ADDRESS = 200;
const MAX_CITY = 100;
const MAX_POSTAL = 20;

export type RowIssue = { field: ImportField | "row"; message: string };

/** An advisor's inline fix, applied in place of the file's cell. */
export type RowOverride = { rowIndex: number; field: ImportField; value: string };

export type ParsedRow = {
  /** 0-based index into the file's data rows, header excluded. */
  rowIndex: number;
  household: ImportHouseholdInput;
  primary: CreateCrmContactInput;
  spouse?: CreateCrmContactInput;
  errors: RowIssue[];
  warnings: RowIssue[];
};

/** Fields whose presence implies a spouse exists even without a first name. */
const SPOUSE_SATELLITE_FIELDS: readonly ImportField[] = [
  "spouseLast",
  "spouseEmail",
  "spouseDob",
];

export function buildRows(
  dataRows: readonly (readonly (string | number)[])[],
  mapping: ColumnMapping,
  overrides: readonly RowOverride[] = [],
): ParsedRow[] {
  const overrideIndex = new Map<string, string>();
  for (const o of overrides) overrideIndex.set(`${o.rowIndex}:${o.field}`, o.value);

  const out: ParsedRow[] = [];

  for (let rowIndex = 0; rowIndex < dataRows.length; rowIndex++) {
    const cells = dataRows[rowIndex] ?? [];

    /** Raw cell for a field: an override wins, then the mapped column. */
    const raw = (field: ImportField): string | number => {
      const override = overrideIndex.get(`${rowIndex}:${field}`);
      if (override !== undefined) return override;
      const col = mapping[field];
      if (col === undefined) return "";
      return cells[col] ?? "";
    };
    const text = (field: ImportField): string => String(raw(field) ?? "").trim();

    const anyValue =
      cells.some((c) => String(c ?? "").trim() !== "") ||
      overrides.some((o) => o.rowIndex === rowIndex && o.value.trim() !== "");
    if (!anyValue) continue;

    const errors: RowIssue[] = [];
    const warnings: RowIssue[] = [];

    const clamp = (field: ImportField, max: number): string => {
      const { value, truncated } = clampText(text(field), max);
      if (truncated) {
        warnings.push({
          field,
          message: `${FIELD_LABELS[field]} was longer than ${max} characters and has been shortened.`,
        });
      }
      return value;
    };

    // --- required -------------------------------------------------------
    const primaryFirst = clamp("primaryFirst", MAX_NAME);
    const primaryLast = clamp("primaryLast", MAX_NAME);
    for (const field of REQUIRED_FIELDS) {
      const value = field === "primaryFirst" ? primaryFirst : primaryLast;
      if (value) continue;
      errors.push({
        field,
        message:
          mapping[field] === undefined
            ? `No column is mapped to ${FIELD_LABELS[field]}.`
            : `${FIELD_LABELS[field]} is required.`,
      });
    }

    // --- optional cells -------------------------------------------------
    const date = (field: ImportField): string | undefined => {
      const value = raw(field);
      if (String(value ?? "").trim() === "") return undefined;
      const parsed = parseImportDate(value);
      if (parsed) return parsed;
      warnings.push({
        field,
        message: `"${String(value)}" isn't a date we can read. Use MM/DD/YYYY.`,
      });
      return undefined;
    };

    const email = (field: ImportField): string | undefined => {
      const value = text(field);
      if (!value) return undefined;
      const parsed = parseEmail(value);
      if (parsed) return parsed;
      warnings.push({ field, message: `"${value}" isn't a valid email address.` });
      return undefined;
    };

    const statusCell = parseStatus(text("status"));
    if (!statusCell.recognized) {
      warnings.push({
        field: "status",
        message: `"${text("status")}" isn't a known status — imported as Prospect.`,
      });
    }

    // Exactly what the household schema accepts — parseState only ever hands
    // back a USPS code, so this needs no re-validation downstream.
    let stateCode: ImportHouseholdInput["state"];
    const stateRaw = text("state");
    if (stateRaw) {
      const parsed = parseState(stateRaw);
      if (parsed) {
        stateCode = parsed;
      } else {
        warnings.push({
          field: "state",
          message: `"${stateRaw}" isn't a US state — left blank.`,
        });
      }
    }

    // xlsx turns "02110" into the number 2110; recover the common US zip.
    const postalRaw = raw("postalCode");
    const postalCode =
      typeof postalRaw === "number"
        ? String(postalRaw).padStart(5, "0")
        : clamp("postalCode", MAX_POSTAL);

    // --- spouse ---------------------------------------------------------
    const spouseFirst = clamp("spouseFirst", MAX_NAME);
    let spouse: CreateCrmContactInput | undefined;
    if (spouseFirst) {
      const spouseLast = clamp("spouseLast", MAX_NAME) || primaryLast;
      spouse = {
        role: "spouse",
        firstName: spouseFirst,
        lastName: spouseLast,
        email: email("spouseEmail"),
        dateOfBirth: date("spouseDob"),
      };
    } else if (SPOUSE_SATELLITE_FIELDS.some((f) => text(f) !== "")) {
      warnings.push({
        field: "spouseFirst",
        message: "Spouse details were ignored — no spouse first name in this row.",
      });
    }

    // --- household ------------------------------------------------------
    const suppliedName = clamp("householdName", MAX_HOUSEHOLD_NAME);
    const derivedName = buildHouseholdName({
      firstName: primaryFirst,
      lastName: primaryLast,
      spouseFirstName: spouse?.firstName ?? null,
      spouseLastName: spouse?.lastName ?? null,
    });

    const household: ImportHouseholdInput = {
      // An advisor who typed a name meant it — lock it against the contact-
      // driven re-derivation, same as ticking "Use a custom name" in the UI.
      name: suppliedName || derivedName,
      nameIsCustom: Boolean(suppliedName),
      status: statusCell.value,
      state: stateCode,
      notes: clamp("notes", MAX_NOTES) || undefined,
    };

    const primary: CreateCrmContactInput = {
      role: "primary",
      firstName: primaryFirst,
      lastName: primaryLast,
      email: email("primaryEmail"),
      phone: clamp("primaryPhone", MAX_PHONE) || undefined,
      dateOfBirth: date("primaryDob"),
      addressLine1: clamp("addressLine1", MAX_ADDRESS) || undefined,
      city: clamp("city", MAX_CITY) || undefined,
      state: stateCode,
      postalCode: postalCode || undefined,
    };

    out.push({ rowIndex, household, primary, spouse, errors, warnings });
  }

  return out;
}
