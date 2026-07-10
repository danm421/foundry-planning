import type { TaxYearParameters } from "@/lib/tax/types";
import type { TaxReturnFacts } from "@/lib/schemas/tax-return-facts";

export type ObservationSeverity = "opportunity" | "watch" | "info";

export interface Observation {
  id: string;
  severity: ObservationSeverity;
  title: string;
  /** Complete sentences, client-readable. Dollar values pre-formatted into the text
   *  by the report layer from `numbers` — body uses {placeholders} NEVER; write
   *  the final copy here with values interpolated at build time. */
  body: string;
  numbers: Record<string, number>;
}

export interface ObservationContext {
  facts: TaxReturnFacts;
  prior: TaxReturnFacts | null;
  /** Params for facts.taxYear (exact seeded year for 2022+). */
  params: TaxYearParameters;
  /** Params for facts.taxYear + 2 — IRMAA's 2-year MAGI lookback. */
  irmaaParams: TaxYearParameters;
  /** Ages at END of the tax year; null when DOB unknown. */
  primaryAge: number | null;
  spouseAge: number | null;
}
