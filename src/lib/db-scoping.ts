import { db } from "@/db";
import {
  accounts,
  clients,
  entities,
  externalBeneficiaries,
  familyMembers,
  liabilities,
  modelPortfolios,
  assetClasses,
  tickerPortfolios,
} from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";

/**
 * Foreign-key validation helpers used by POST/PUT handlers to enforce
 * that every FK in a request body actually belongs to the caller's
 * firm. Without these checks, an attacker who learned any table row's
 * id could set (e.g.) `ownerEntityId: "other-firm-entity"` and the DB
 * would happily write the row cross-tenant because the insert path
 * itself doesn't see the firmId.
 *
 * Each helper returns a pair `[ok, reason]`. Callers should return a
 * 400 when `ok` is false.
 */

type FkCheck = { ok: true } | { ok: false; reason: string };

/** Verify every account id belongs to `clientId` (and thus the firm). */
export async function assertAccountsInClient(
  clientId: string,
  accountIds: (string | null | undefined)[]
): Promise<FkCheck> {
  const ids = accountIds.filter((v): v is string => typeof v === "string" && v.length > 0);
  if (ids.length === 0) return { ok: true };
  const rows = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.clientId, clientId), inArray(accounts.id, ids)));
  const found = new Set(rows.map((r) => r.id));
  const missing = ids.find((v) => !found.has(v));
  return missing
    ? { ok: false, reason: `Account ${missing} not owned by this client` }
    : { ok: true };
}

/**
 * Verify every account id belongs to `clientId` AND has category = 'business'.
 * Used by income/expense routes to enforce that `ownerAccountId` references a
 * business account — the schema FK is only "any account", so without this a
 * non-UI client could attach to a cash/retirement/etc. account.
 */
export async function assertBusinessAccountsInClient(
  clientId: string,
  accountIds: (string | null | undefined)[]
): Promise<FkCheck> {
  const ids = accountIds.filter((v): v is string => typeof v === "string" && v.length > 0);
  if (ids.length === 0) return { ok: true };
  const rows = await db
    .select({ id: accounts.id, category: accounts.category })
    .from(accounts)
    .where(and(eq(accounts.clientId, clientId), inArray(accounts.id, ids)));
  const business = new Set(rows.filter((r) => r.category === "business").map((r) => r.id));
  const missing = ids.find((v) => !business.has(v));
  return missing
    ? { ok: false, reason: `Account ${missing} is not a business account` }
    : { ok: true };
}

/** Verify every liability id belongs to `clientId` (and thus the firm). */
export async function assertLiabilitiesInClient(
  clientId: string,
  liabilityIds: (string | null | undefined)[]
): Promise<FkCheck> {
  const ids = liabilityIds.filter((v): v is string => typeof v === "string" && v.length > 0);
  if (ids.length === 0) return { ok: true };
  const rows = await db
    .select({ id: liabilities.id })
    .from(liabilities)
    .where(and(eq(liabilities.clientId, clientId), inArray(liabilities.id, ids)));
  const found = new Set(rows.map((r) => r.id));
  const missing = ids.find((v) => !found.has(v));
  return missing
    ? { ok: false, reason: `Liability ${missing} not owned by this client` }
    : { ok: true };
}

/** Verify every entity id belongs to `clientId`. */
export async function assertEntitiesInClient(
  clientId: string,
  entityIds: (string | null | undefined)[]
): Promise<FkCheck> {
  const ids = entityIds.filter((v): v is string => typeof v === "string" && v.length > 0);
  if (ids.length === 0) return { ok: true };
  const rows = await db
    .select({ id: entities.id })
    .from(entities)
    .where(and(eq(entities.clientId, clientId), inArray(entities.id, ids)));
  const found = new Set(rows.map((r) => r.id));
  const missing = ids.find((v) => !found.has(v));
  return missing
    ? { ok: false, reason: `Entity ${missing} not owned by this client` }
    : { ok: true };
}

/** Verify every family-member id belongs to `clientId`. */
export async function assertFamilyMembersInClient(
  clientId: string,
  familyMemberIds: (string | null | undefined)[]
): Promise<FkCheck> {
  const ids = familyMemberIds.filter((v): v is string => typeof v === "string" && v.length > 0);
  if (ids.length === 0) return { ok: true };
  const rows = await db
    .select({ id: familyMembers.id })
    .from(familyMembers)
    .where(and(eq(familyMembers.clientId, clientId), inArray(familyMembers.id, ids)));
  const found = new Set(rows.map((r) => r.id));
  const missing = ids.find((v) => !found.has(v));
  return missing
    ? { ok: false, reason: `Family member ${missing} not owned by this client` }
    : { ok: true };
}

/** Verify every external-beneficiary id belongs to `clientId`. */
export async function assertExternalBeneficiariesInClient(
  clientId: string,
  externalBeneficiaryIds: (string | null | undefined)[]
): Promise<FkCheck> {
  const ids = externalBeneficiaryIds.filter((v): v is string => typeof v === "string" && v.length > 0);
  if (ids.length === 0) return { ok: true };
  const rows = await db
    .select({ id: externalBeneficiaries.id })
    .from(externalBeneficiaries)
    .where(and(eq(externalBeneficiaries.clientId, clientId), inArray(externalBeneficiaries.id, ids)));
  const found = new Set(rows.map((r) => r.id));
  const missing = ids.find((v) => !found.has(v));
  return missing
    ? { ok: false, reason: `External beneficiary ${missing} not owned by this client` }
    : { ok: true };
}

/** Verify every model-portfolio id belongs to `firmId`. */
export async function assertModelPortfoliosInFirm(
  firmId: string,
  ids: (string | null | undefined)[]
): Promise<FkCheck> {
  const filtered = ids.filter(
    (v): v is string => typeof v === "string" && v.length > 0
  );
  if (filtered.length === 0) return { ok: true };
  const rows = await db
    .select({ id: modelPortfolios.id })
    .from(modelPortfolios)
    .where(
      and(eq(modelPortfolios.firmId, firmId), inArray(modelPortfolios.id, filtered))
    );
  const found = new Set(rows.map((r) => r.id));
  const missing = filtered.find((v) => !found.has(v));
  return missing
    ? { ok: false, reason: `Model portfolio ${missing} not available to this firm` }
    : { ok: true };
}

/** Verify every fund (ticker) portfolio id belongs to `firmId`. */
export async function assertTickerPortfoliosInFirm(
  firmId: string,
  ids: (string | null | undefined)[]
): Promise<FkCheck> {
  const filtered = ids.filter((v): v is string => typeof v === "string" && v.length > 0);
  if (filtered.length === 0) return { ok: true };
  const rows = await db
    .select({ id: tickerPortfolios.id })
    .from(tickerPortfolios)
    .where(and(eq(tickerPortfolios.firmId, firmId), inArray(tickerPortfolios.id, filtered)));
  const found = new Set(rows.map((r) => r.id));
  const missing = filtered.find((v) => !found.has(v));
  return missing
    ? { ok: false, reason: `Fund portfolio ${missing} not available to this firm` }
    : { ok: true };
}

/** Verify every asset-class id belongs to `firmId`. */
export async function assertAssetClassesInFirm(
  firmId: string,
  ids: (string | null | undefined)[]
): Promise<FkCheck> {
  const filtered = ids.filter(
    (v): v is string => typeof v === "string" && v.length > 0
  );
  if (filtered.length === 0) return { ok: true };
  const rows = await db
    .select({ id: assetClasses.id })
    .from(assetClasses)
    .where(and(eq(assetClasses.firmId, firmId), inArray(assetClasses.id, filtered)));
  const found = new Set(rows.map((r) => r.id));
  const missing = filtered.find((v) => !found.has(v));
  return missing
    ? { ok: false, reason: `Asset class ${missing} not available to this firm` }
    : { ok: true };
}

/**
 * Verify every account id belongs to `clientId` AND has category = 'real_estate'.
 * Used by the income write path so `linkedPropertyId` can only reference a real
 * estate account the org owns.
 */
export async function assertRealEstateAccountsInClient(
  clientId: string,
  accountIds: (string | null | undefined)[]
): Promise<FkCheck> {
  const ids = accountIds.filter((v): v is string => typeof v === "string" && v.length > 0);
  if (ids.length === 0) return { ok: true };
  const rows = await db
    .select({ id: accounts.id, category: accounts.category })
    .from(accounts)
    .where(and(eq(accounts.clientId, clientId), inArray(accounts.id, ids)));
  const realEstate = new Set(rows.filter((r) => r.category === "real_estate").map((r) => r.id));
  const missing = ids.find((v) => !realEstate.has(v));
  return missing
    ? { ok: false, reason: `Account ${missing} is not a real estate account` }
    : { ok: true };
}

/** Look up a client by id + firm id; returns null if not found. */
export async function findClientInFirm(clientId: string, firmId: string) {
  const [row] = await db
    .select({ id: clients.id })
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.firmId, firmId)));
  return row ?? null;
}
