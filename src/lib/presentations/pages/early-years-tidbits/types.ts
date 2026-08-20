import type { Tidbit } from "@/lib/presentations/tidbits";

export interface EarlyYearsTidbitsPageData {
  /** Empty when the advisor picked nothing — the sheet then says so rather than
   *  printing a heading over blank paper. A sheet's furniture is a claim too. */
  tidbits: Tidbit[];
}

/** Two columns of three, which is what fits one sheet. The schema and the
 *  picker each enforce this independently, so it lives in one place — a picker
 *  that let through what the schema rejects would lose the advisor's seventh
 *  pick on save with no explanation. */
export const TIDBITS_PAGE_MAX = 6;

export interface EarlyYearsTidbitsPageOptions {
  /** Tidbit ids, capped at `TIDBITS_PAGE_MAX`. */
  tidbits: string[];
}

export const EARLY_YEARS_TIDBITS_OPTIONS_DEFAULT: EarlyYearsTidbitsPageOptions = {
  tidbits: [],
};
