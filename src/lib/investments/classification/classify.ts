// src/lib/investments/classification/classify.ts
import { CLASSIFIER_VERSION, type ClassifiedSecurity } from "./types";
import { mapEodhdToInput, fetchEodhdFundamentals } from "./eodhd-adapter";
import { deriveAssetClassBlend } from "./derive";

export interface ClassifyDeps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fetchEodhd?: (ticker: string) => Promise<any>;
}

/** Resolve a ticker to a ClassifiedSecurity. Returns null on any failure
 *  (unknown ticker, network/API error) — callers fall back to manual entry.
 *  NEVER throws for classification failures. */
export async function classifySecurity(
  ticker: string,
  deps: ClassifyDeps = {},
): Promise<ClassifiedSecurity | null> {
  const fetchEodhd = deps.fetchEodhd ?? fetchEodhdFundamentals;
  try {
    const raw = await fetchEodhd(ticker);
    if (!raw || !raw.General) return null;
    const input = mapEodhdToInput(ticker, raw);
    const weights = deriveAssetClassBlend(input);
    return {
      identifierType: "ticker",
      identifier: ticker.toUpperCase(),
      name: raw.General?.Name,
      securityType: input.securityType,
      classifierSource: "eodhd",
      classifierVersion: CLASSIFIER_VERSION,
      rawPayload: raw,
      weights,
    };
  } catch {
    return null;
  }
}
