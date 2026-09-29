/**
 * Resolves an account's projected balance at a projection year, or undefined
 * when the projection holds no row for that year / no ledger for that account
 * (a gift dated before `planStartYear`, or a pre-activation account).
 *
 * Callers that must produce a number treat undefined as 0 — that is what the
 * engine does. Callers showing the figure to an advisor should keep the
 * distinction, so they can say whether the number is projected or a fallback.
 */
export type AccountValueAtYear = (
  accountId: string,
  year: number,
) => number | undefined;

/**
 * The account-balance resolver the engine values an asset gift with — a
 * top-level business at its consolidated value. It is the engine's own
 * `buildGiftValueAtYear`, not a copy, so every surface that previews, reports
 * on, or sizes an asset gift quotes the exemption the gift actually consumes.
 */
export { buildGiftValueAtYear as buildAccountValueAtYear } from "@/engine/business/business-tree";
