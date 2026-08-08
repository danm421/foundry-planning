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

// These mirror the `.max()` caps in createCrmHouseholdSchema and
// createCrmContactSchema (@/lib/crm/schemas) — NOT the database, whose
// crm_households / crm_household_contacts columns are unbounded `text()`.
// The zod caps are the only thing an over-long cell would hit, so clamping
// here turns a commit-time rejection into a warning on one row.
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
  /**
   * Valid ONLY when `errors` is empty. An errored row still carries a
   * household so the UI can render what it read, but with no primary name
   * there is nothing to derive from and `name` is `""` — which
   * importHouseholdSchema rejects. Never commit a row whose `errors` is
   * non-empty; filter on `errors.length === 0`, don't rely on try/catch.
   */
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
  // Row indices with at least one non-blank override — mirrors the
  // `overrides.some((o) => o.rowIndex === rowIndex && o.value.trim() !== "")`
  // predicate below, precomputed once instead of re-scanning the whole
  // overrides array per row.
  const rowsWithNonBlankOverride = new Set<number>();
  for (const o of overrides) {
    overrideIndex.set(`${o.rowIndex}:${o.field}`, o.value);
    if (o.value.trim() !== "") rowsWithNonBlankOverride.add(o.rowIndex);
  }

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
      rowsWithNonBlankOverride.has(rowIndex);
    if (!anyValue) continue;

    const errors: RowIssue[] = [];
    const warnings: RowIssue[] = [];

    const clampValue = (field: ImportField, raw: string, max: number): string => {
      const { value, truncated } = clampText(raw, max);
      if (truncated) {
        warnings.push({
          field,
          message: `${FIELD_LABELS[field]} was longer than ${max} characters and has been shortened.`,
        });
      }
      return value;
    };
    const clamp = (field: ImportField, max: number): string =>
      clampValue(field, text(field), max);

    // --- required -------------------------------------------------------
    const primaryFirst = clamp("primaryFirst", MAX_NAME);
    const primaryLast = clamp("primaryLast", MAX_NAME);
    // Keyed lookup, not a ternary: a future REQUIRED_FIELDS entry with no
    // value here reads as missing and errors loudly, rather than being
    // silently validated against the primary's last name.
    const requiredValues: Partial<Record<ImportField, string>> = {
      primaryFirst,
      primaryLast,
    };
    for (const field of REQUIRED_FIELDS) {
      if (requiredValues[field]) continue;
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
    // Both branches clamp, so an over-long postal code is a warning either
    // way — an unclamped value would be a silent zod rejection at commit,
    // i.e. a row lost with nothing shown to the advisor.
    const postalRaw = raw("postalCode");
    const postalCode =
      typeof postalRaw === "number"
        ? clampValue("postalCode", String(postalRaw).padStart(5, "0"), MAX_POSTAL)
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
    const suppliedName = text("householdName");
    const derivedName = buildHouseholdName({
      firstName: primaryFirst,
      lastName: primaryLast,
      spouseFirstName: spouse?.firstName ?? null,
      spouseLastName: spouse?.lastName ?? null,
    });

    const household: ImportHouseholdInput = {
      // An advisor who typed a name meant it — lock it against the contact-
      // driven re-derivation, same as ticking "Use a custom name" in the UI.
      //
      // Clamped AFTER the fallback, so the DERIVED name goes through the same
      // cap as a supplied one. The parts are clamped at MAX_NAME (100) each,
      // so `"${first} ${last}"` reaches 201 characters — one over
      // importHouseholdSchema's `name.max(200)`, which would 400 the entire
      // batch rather than warn on one row.
      name: clampValue("householdName", suppliedName || derivedName, MAX_HOUSEHOLD_NAME),
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
