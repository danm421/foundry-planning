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

/** Replace bequests + residuary recipients on one will. Pure. */
export function changeWillBequests(
  data: ClientData,
  willId: string,
  bequests: Will["bequests"],
  residuaryRecipients: Will["residuaryRecipients"],
): ClientData {
  let changed = false;
  const wills = (data.wills ?? []).map((w) => {
    if (w.id !== willId) return w;
    changed = true;
    return { ...w, bequests, residuaryRecipients };
  });
  return changed ? { ...data, wills } : data;
}
