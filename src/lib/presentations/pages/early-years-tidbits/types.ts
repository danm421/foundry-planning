import type { Tidbit } from "@/lib/presentations/tidbits";

export interface EarlyYearsTidbitsPageData {
  /** Empty when the advisor picked nothing — the sheet then says so rather than
   *  printing a heading over blank paper. A sheet's furniture is a claim too. */
  tidbits: Tidbit[];
}

export interface EarlyYearsTidbitsPageOptions {
  /** Tidbit ids, max 6 — two columns of three, which is what fits one sheet. */
  tidbits: string[];
}

export const EARLY_YEARS_TIDBITS_OPTIONS_DEFAULT: EarlyYearsTidbitsPageOptions = {
  tidbits: [],
};
