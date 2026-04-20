import { db } from "@foundry/db";
import {
  accounts,
  clients,
  entities,
  modelPortfolios,
  assetClasses,
} from "@foundry/db/schema";
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

/** Look up a client by id + firm id; returns null if not found. */
export async function findClientInFirm(clientId: string, firmId: string) {
  const [row] = await db
    .select({ id: clients.id })
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.firmId, firmId)));
  return row ?? null;
}
