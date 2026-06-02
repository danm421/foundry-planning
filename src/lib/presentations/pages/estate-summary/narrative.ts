import { fmtUsd, fmtPct, shrink, type EstateSummaryHousehold } from "./aggregate";

export interface NarrativeInput {
  today: EstateSummaryHousehold;
  eol: EstateSummaryHousehold;
  isMarried: boolean;
  /** True when the first death incurs federal+state tax at end of life (i.e. the
   *  marital deduction did NOT fully shelter it). */
  firstDeathTaxedEol: boolean;
  /** Share of end-of-life net to heirs passing in trust (0..1). */
  inTrustShareEol: number;
}

export function buildNarrative(input: NarrativeInput): string[] {
  const { today, eol, isMarried, firstDeathTaxedEol, inTrustShareEol } = input;
  const lines: string[] = [];

  const shrinkEol = shrink(eol);
  const shrinkToday = shrink(today);
  lines.push(
    `At end of life, estate taxes & costs consume ${fmtUsd(eol.taxAndCosts)} (${fmtPct(shrinkEol)}) of the estate — up from ${fmtUsd(today.taxAndCosts)} (${fmtPct(shrinkToday)}) today.`,
  );

  // Dominant driver among the four cost components at end of life.
  const drivers: Array<[string, number]> = [
    ["federal estate tax", eol.federal],
    ["state estate tax", eol.state],
    ["probate & administration", eol.probate],
    ["IRD (income in respect of a decedent)", eol.ird],
  ];
  drivers.sort((a, b) => b[1] - a[1]);
  if (drivers[0][1] > 0) {
    const placement = isMarried ? " at the second death" : "";
    lines.push(`The largest erosion is ${drivers[0][0]}${placement}, at ${fmtUsd(drivers[0][1])}.`);
  } else {
    lines.push(`The estate passes with minimal tax under current assumptions.`);
  }

  if (isMarried && !firstDeathTaxedEol) {
    lines.push(`The first death is fully sheltered by the marital deduction; tax is deferred to the second death.`);
  }

  if (inTrustShareEol > 0) {
    lines.push(`Roughly ${fmtPct(inTrustShareEol)} of heirs' end-of-life inheritance passes in trust.`);
  }

  return lines;
}
