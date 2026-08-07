/**
 * Canonical import fields and header detection.
 *
 * PURE + CLIENT-SAFE: no db, no exceljs, no server-only imports. The import
 * wizard imports this module directly, which is why the template column list
 * lives here and nowhere else.
 */

export const IMPORT_FIELDS = [
  "householdName",
  "primaryFirst",
  "primaryLast",
  "primaryEmail",
  "primaryPhone",
  "primaryDob",
  "spouseFirst",
  "spouseLast",
  "spouseEmail",
  "spouseDob",
  "status",
  "notes",
  "addressLine1",
  "city",
  "state",
  "postalCode",
] as const;

export type ImportField = (typeof IMPORT_FIELDS)[number];

/** field → column index in the uploaded file. Absent = not imported. */
export type ColumnMapping = Partial<Record<ImportField, number>>;

/**
 * The downloadable template's header row, in field order. `advisor_id` is
 * deliberately absent — every imported household is assigned to the advisor
 * doing the upload. Old files that still carry the column are detected as
 * unknown and ignored.
 */
export const TEMPLATE_HEADERS = [
  "household_name",
  "primary_first",
  "primary_last",
  "primary_email",
  "primary_phone",
  "primary_dob",
  "spouse_first",
  "spouse_last",
  "spouse_email",
  "spouse_dob",
  "status",
  "notes",
  "address_line1",
  "city",
  "state",
  "postal_code",
] as const;

export const FIELD_LABELS: Record<ImportField, string> = {
  householdName: "Household name",
  primaryFirst: "Primary first name",
  primaryLast: "Primary last name",
  primaryEmail: "Primary email",
  primaryPhone: "Primary phone",
  primaryDob: "Primary date of birth",
  spouseFirst: "Spouse first name",
  spouseLast: "Spouse last name",
  spouseEmail: "Spouse email",
  spouseDob: "Spouse date of birth",
  status: "Status",
  notes: "Notes",
  addressLine1: "Address",
  city: "City",
  state: "State",
  postalCode: "Postal code",
};

/** Fields whose absence makes a row unimportable. */
export const REQUIRED_FIELDS: readonly ImportField[] = ["primaryFirst", "primaryLast"];

/**
 * Every spelling we accept for a column, already normalized. The canonical
 * template header is always first. Order within IMPORT_FIELDS decides ties:
 * a header of exactly "name" goes to householdName, not primaryFirst.
 */
const ALIASES: Record<ImportField, readonly string[]> = {
  householdName: ["household name", "household", "family name", "family", "client name", "account name", "name"],
  primaryFirst: ["primary first", "primary first name", "first name", "first", "given name", "client first name", "client first"],
  primaryLast: ["primary last", "primary last name", "last name", "last", "surname", "client last name", "client last"],
  primaryEmail: ["primary email", "email", "email address", "client email"],
  primaryPhone: ["primary phone", "phone", "phone number", "mobile", "cell", "client phone"],
  primaryDob: ["primary dob", "dob", "date of birth", "birth date", "birthdate", "primary date of birth", "client dob"],
  spouseFirst: ["spouse first", "spouse first name", "spouse", "partner first name", "spouse given name"],
  spouseLast: ["spouse last", "spouse last name", "spouse surname", "partner last name"],
  spouseEmail: ["spouse email", "spouse email address", "partner email"],
  spouseDob: ["spouse dob", "spouse date of birth", "spouse birth date", "partner dob"],
  status: ["status", "client status", "stage", "household status"],
  notes: ["notes", "note", "comments", "comment"],
  addressLine1: ["address line1", "address", "address 1", "street", "street address", "address line 1"],
  city: ["city", "town"],
  state: ["state", "st", "state code", "province"],
  postalCode: ["postal code", "zip", "zip code", "postcode", "postal"],
};

/** Lowercase, punctuation → spaces, collapse runs, trim. */
export function normalizeHeader(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Best-effort field → column mapping for an uploaded header row.
 *
 * Unknown columns are ignored rather than fatal — the whole point of the
 * rework is that a header we can't read is something the advisor corrects in
 * Review, not a reason to reject the file. A column is claimed by at most one
 * field; earlier fields in IMPORT_FIELDS win.
 */
export function detectMapping(header: readonly string[]): ColumnMapping {
  const normalized = header.map((h) => normalizeHeader(String(h ?? "")));
  const mapping: ColumnMapping = {};
  const claimed = new Set<number>();
  for (const field of IMPORT_FIELDS) {
    for (const alias of ALIASES[field]) {
      const idx = normalized.findIndex((h, i) => h === alias && !claimed.has(i));
      if (idx !== -1) {
        mapping[field] = idx;
        claimed.add(idx);
        break;
      }
    }
  }
  return mapping;
}

/**
 * Coerce an untrusted mapping (from the remap request body) into a
 * ColumnMapping. Unknown keys and out-of-range indices are dropped rather
 * than rejected, so a stale client can never 400 the whole request.
 */
export function sanitizeMapping(raw: unknown, columnCount: number): ColumnMapping {
  if (typeof raw !== "object" || raw === null) return {};
  const mapping: ColumnMapping = {};
  for (const field of IMPORT_FIELDS) {
    const value = (raw as Record<string, unknown>)[field];
    if (typeof value !== "number" || !Number.isInteger(value)) continue;
    if (value < 0 || value >= columnCount) continue;
    mapping[field] = value;
  }
  return mapping;
}
