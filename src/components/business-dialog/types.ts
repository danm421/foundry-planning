import type { Account } from "@/engine/types";
import type { AccountOwner } from "@/engine/ownership";

export type BusinessTab = "details" | "flows" | "assets" | "notes";

/** Imperative handle that lets the dialog footer trigger a save on tab-switch. */
export interface BusinessFormAutoSaveHandle {
  saveAsync: () => Promise<{ ok: true; recordId?: string; account?: Account } | { ok: false; error: string }>;
}

/** Mode discriminator for the dialog. */
export type BusinessDialogMode = "add" | "edit";

/** Subset of Account this dialog accepts as `editing`. */
export interface BusinessAccount extends Account {
  /** Always "business" — narrowed for type-safety inside the dialog. */
  category: "business";
}

/** Owner type-narrowed for the business form — kind is family_member or entity. */
export type BusinessFormOwner = Extract<AccountOwner, { kind: "family_member" } | { kind: "entity" }>;
