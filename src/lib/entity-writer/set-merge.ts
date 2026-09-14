// src/lib/entity-writer/set-merge.ts
import { DETAIL_ENTITIES } from "@/domain/forge/detail-fields";
import type { DetailEntity } from "@/domain/forge/detail-fields";

/**
 * Entities whose write REPLACES the whole set — the body is a bare array and
 * whatever it omits is deleted.
 *
 * Derived from the map rather than hand-listed, so a new bare-array entity
 * cannot be added without landing here. A naive write for any of these deletes
 * every existing row, and three of the four are beneficiary designations.
 */
export const SET_REPLACING_ENTITY_IDS: readonly string[] = DETAIL_ENTITIES
  .filter((e) => e.payloadShape === "array")
  .map((e) => e.id);

function sameIdentity(
  entity: DetailEntity,
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): boolean {
  const identity = entity.identity;
  if (!identity?.length) return false;
  return identity.every((key) => {
    const left = a[key];
    const right = b[key];
    if (left === undefined || right === undefined) return false;
    if (typeof left === "string" && typeof right === "string") {
      return left.trim().toLowerCase() === right.trim().toLowerCase();
    }
    return left === right;
  });
}

/**
 * Merge one incoming row into the current set for a set-replacing entity.
 *
 * The contract is that the returned array is what will EXIST after the write,
 * so it always contains every existing row unless one was deliberately
 * superseded by identity. Returning a shorter array is a data-loss bug.
 *
 * ⚠️ NO LIVE CALLER TODAY (final review M9, Ruling 39 — stated rather than
 * wired). The only path into `buildWriteRequest` is `commitMapRow`, which
 * passes no `existingSet`, so every `payloadShape: "array"` entity is REFUSED
 * before reaching here (`build-request.ts`, the "replaces the whole set"
 * branch). That is the correct fail-closed direction and not a defect: writing
 * one of these without the current rows deletes every existing beneficiary.
 * But it does mean this function and `SET_REPLACING_ENTITY_IDS` above are
 * exercised only by their own tests. Whoever gives the review surface a way to
 * load the current set is the first real caller, and should read
 * `sameIdentity`'s "supersedes only the FIRST match" behaviour before doing so.
 */
export function mergeIntoSet(args: {
  entity: DetailEntity;
  existing: Record<string, unknown>[];
  incoming: Record<string, unknown>;
}): { rows: Record<string, unknown>[]; replaced: number | null } {
  const { entity, existing, incoming } = args;
  const rows = [...existing];

  const index = rows.findIndex((current) => sameIdentity(entity, current, incoming));
  if (index >= 0) {
    rows[index] = incoming;
    return { rows, replaced: index };
  }

  rows.push(incoming);
  return { rows, replaced: null };
}
