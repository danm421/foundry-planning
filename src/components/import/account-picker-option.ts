import { formatAccountCategory } from "@/lib/accounts/category-labels";
import type { MatchCandidate } from "./match-link-picker";

/**
 * The parts of an existing account the link picker shows. Structural, so both
 * the matcher's `AccountCandidate` (statement chat) and a row read straight off
 * `GET /api/clients/[id]/accounts` (the import review wizards) fit it.
 */
export interface PickerAccount {
  id: string;
  name: string;
  category: string;
  custodian: string | null;
  accountNumberLast4: string | null;
  value: number;
  ownerNames?: string[];
}

/** A row as `GET /api/clients/[id]/accounts` sends it — `value` is a decimal
 *  column, so it arrives as a string. */
export interface AccountRow {
  id: string;
  name: string;
  category?: string;
  subType?: string;
  custodian?: string | null;
  accountNumberLast4?: string | null;
  value?: string | number;
}

export function toPickerAccount(a: AccountRow): PickerAccount {
  return {
    id: a.id,
    name: a.name,
    category: a.category ?? "",
    custodian: a.custodian ?? null,
    accountNumberLast4: a.accountNumberLast4 ?? null,
    value: Number(a.value ?? 0),
  };
}

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/**
 * Enough of an existing account to tell two similar ones apart in the picker.
 * The search box filters on name AND subtitle, so owner, custodian and last 4
 * are searchable too — which is how an advisor finds the right "Brokerage"
 * among four of them.
 *
 * OWNER leads the subtitle and VALUE is lifted out onto its own line opposite
 * the name. Whenever the matcher cannot settle a row the advisor settles it by
 * hand, and the two questions they ask of a candidate are "is this the right
 * person's account" and "is that roughly the right money" — a picker that
 * answers neither without leaving the page is the reason a row stays
 * Ambiguous. Custodian, last 4 and category stay, after the owner, because
 * they are what separates two of one person's accounts from each other.
 */
export function accountPickerOption(a: PickerAccount): MatchCandidate {
  const parts = [
    a.ownerNames?.length ? a.ownerNames.join(" & ") : null,
    a.custodian,
    a.accountNumberLast4 ? `x${a.accountNumberLast4}` : null,
    formatAccountCategory(a.category),
  ].filter(Boolean);
  return {
    id: a.id,
    name: a.name,
    subtitle: parts.join(" · "),
    amount: usd.format(a.value),
  };
}
