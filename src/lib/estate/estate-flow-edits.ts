import type { ClientData, Account, BeneficiaryRef, Will } from "@/engine/types";

type AccountOwners = Account["owners"];

/** Replace the owners array on one account. Pure — input is never mutated. */
export function changeOwner(
  data: ClientData,
  accountId: string,
  owners: AccountOwners,
): ClientData {
  let changed = false;
  const accounts = data.accounts.map((a) => {
    if (a.id !== accountId) return a;
    changed = true;
    return { ...a, owners };
  });
  return changed ? { ...data, accounts } : data;
}

/** Replace the beneficiaries fat-field on an account or entity. Pure. */
export function changeBeneficiaries(
  data: ClientData,
  targetKind: "account" | "entity",
  targetId: string,
  beneficiaries: BeneficiaryRef[],
): ClientData {
  if (targetKind === "account") {
    let changed = false;
    const accounts = data.accounts.map((a) => {
      if (a.id !== targetId) return a;
      changed = true;
      return { ...a, beneficiaries };
    });
    return changed ? { ...data, accounts } : data;
  }
  let changed = false;
  const entities = (data.entities ?? []).map((e) => {
    if (e.id !== targetId) return e;
    changed = true;
    return { ...e, beneficiaries };
  });
  return changed ? { ...data, entities } : data;
}

/**
 * Insert or replace wills by id. Wills with a matching id are replaced;
 * wills with a new id are appended. Pure — input is never mutated.
 *
 * The distribution dialog uses this to write the client's will and an
 * auto-created spouse will (the second-death cascade) in a single edit.
 */
export function upsertWills(data: ClientData, wills: Will[]): ClientData {
  if (wills.length === 0) return data;
  const byId = new Map(wills.map((w) => [w.id, w]));
  const existing = data.wills ?? [];
  const merged = existing.map((w) => byId.get(w.id) ?? w);
  const existingIds = new Set(existing.map((w) => w.id));
  for (const w of wills) {
    if (!existingIds.has(w.id)) merged.push(w);
  }
  return { ...data, wills: merged };
}
