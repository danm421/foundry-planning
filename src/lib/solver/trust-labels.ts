import type { ClientData, WillBequest } from "@/engine/types";
import { CO_CLIENT_LABEL } from "@/lib/owner-labels";

// Small display helpers shared by the guided trust wizard and the Estate
// planning overview. Pure; no React, no DB.

type Role = "client" | "spouse";

/** A household member's first name; the second person falls back to the co-client label. */
export function roleFirstName(role: Role, tree: ClientData): string {
  return role === "client" ? tree.client.firstName : (tree.client.spouseName ?? CO_CLIENT_LABEL);
}

/** An account's name, or `fallback` when it is missing or blank. */
export function accountName(accountId: string, tree: ClientData, fallback = "an account"): string {
  return tree.accounts.find((a) => a.id === accountId)?.name?.trim() || fallback;
}

/** 0–100 → "25%" / "33.33%". */
export const pct = (n: number): string => `${Number(n.toFixed(2))}%`;

/** Which will a bequest sits in, and when it applies, e.g. "Pat's will, if Sam
 *  survives". A married couple's unconditional clause says "either way"; a
 *  single client's will has no other case to name. */
export function bequestWhen(grantor: Role, condition: WillBequest["condition"], tree: ClientData): string {
  const will = `${roleFirstName(grantor, tree)}'s will`;
  const other = roleFirstName(grantor === "client" ? "spouse" : "client", tree);
  switch (condition) {
    case "if_spouse_survives":
      return `${will}, if ${other} survives`;
    case "if_spouse_predeceased":
      return `${will}, if ${other} has died`;
    case "always":
      return tree.client.spouseDob != null ? `${will}, either way` : will;
  }
}
