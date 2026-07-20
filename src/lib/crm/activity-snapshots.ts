import type { EntitySnapshot } from "@/lib/audit/types";

/**
 * Pure row → snapshot builders for the CRM activity feed.
 *
 * Unlike `src/lib/audit/snapshots/*`, these take an already-loaded row and
 * must NOT import `@/db` — the update paths already hold both the pre-update
 * row and the `.returning()` result, so no query is needed.
 *
 * Opaque UUID columns (`id`, `householdId`, `contactId`, `familyMemberId`)
 * are deliberately omitted: a raw UUID rendered in a feed is noise, and the
 * feed already knows which household it belongs to.
 */

type ContactFields = {
  id?: string;
  familyMemberId?: string | null;
  householdId?: string;
  firstName?: string | null;
  lastName?: string | null;
  preferredName?: string | null;
  role?: string | null;
  dateOfBirth?: string | null;
  ssnLast4?: string | null;
  email?: string | null;
  phone?: string | null;
  mobile?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
  maritalStatus?: string | null;
  employmentStatus?: string | null;
  employer?: string | null;
  occupation?: string | null;
  relationshipLabel?: string | null;
  notes?: string | null;
};

const CONTACT_KEYS: Array<keyof ContactFields> = [
  "firstName", "lastName", "preferredName", "role", "dateOfBirth",
  "ssnLast4", "email", "phone", "mobile", "addressLine1", "addressLine2",
  "city", "state", "postalCode", "country", "maritalStatus",
  "employmentStatus", "employer", "occupation", "relationshipLabel", "notes",
];

export function toCrmContactSnapshot(row: ContactFields): EntitySnapshot {
  const snap: EntitySnapshot = {};
  for (const key of CONTACT_KEYS) {
    snap[key] = row[key] ?? null;
  }
  return snap;
}

type AccountFields = {
  accountType?: string | null;
  custodian?: string | null;
  accountNumberLast4?: string | null;
  balance?: string | number | null;
  balanceAsOf?: string | null;
  notes?: string | null;
};

export function toCrmAccountSnapshot(row: AccountFields): EntitySnapshot {
  return {
    accountType: row.accountType ?? null,
    custodian: row.custodian ?? null,
    accountNumberLast4: row.accountNumberLast4 ?? null,
    // Drizzle returns `numeric` as a string; currency formatting needs a number.
    balance: row.balance == null ? null : Number(row.balance),
    balanceAsOf: row.balanceAsOf ?? null,
    notes: row.notes ?? null,
  };
}
