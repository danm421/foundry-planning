import type { MedicareDetector } from "./types";

export const survivorTierShock: MedicareDetector = ({ years }) => {
  let survivorYearIndex = -1;
  let survivor: "client" | "spouse" | null = null;

  for (let i = 1; i < years.length; i++) {
    const prev = years[i - 1]!;
    const curr = years[i]!;
    const prevMfj =
      prev.medicare?.client?.irmaaFilingStatus === "mfj" ||
      prev.medicare?.spouse?.irmaaFilingStatus === "mfj";
    const currClientSingle = curr.medicare?.client?.irmaaFilingStatus === "single" && curr.medicare.client?.enrolled;
    const currSpouseSingle = curr.medicare?.spouse?.irmaaFilingStatus === "single" && curr.medicare.spouse?.enrolled;

    if (prevMfj && (currClientSingle || currSpouseSingle)) {
      survivorYearIndex = i;
      survivor = currClientSingle ? "client" : "spouse";
      break;
    }
  }

  if (survivorYearIndex === -1 || !survivor) return null;

  const survivorYear = years[survivorYearIndex]!;
  const survivorTier = survivorYear.medicare?.[survivor]?.irmaaTier ?? 0;
  const priorYear = years[survivorYearIndex - 1]!;
  const priorMfjTier =
    priorYear.medicare?.[survivor]?.irmaaTier ??
    priorYear.medicare?.client?.irmaaTier ??
    priorYear.medicare?.spouse?.irmaaTier ?? 0;

  if (survivorTier - priorMfjTier < 2) return null;

  const remainingYears = years.slice(survivorYearIndex);
  const totalSurcharge = remainingYears.reduce((sum, y) => {
    const d = y.medicare?.[survivor!];
    return sum + (d?.partBIrmaaSurcharge ?? 0) + (d?.partDIrmaaSurcharge ?? 0);
  }, 0);

  return {
    id: "survivor-shock",
    severity: "alert",
    title: `Survivor IRMAA jump — tier ${priorMfjTier} → tier ${survivorTier} in ${survivorYear.year}`,
    body: `When the first spouse passes, filing status shifts to single. By ${survivorYear.year} the IRMAA lookback uses single brackets, jumping the surviving spouse to tier ${survivorTier}. Cumulative IRMAA surcharge through end of plan: ~$${Math.round(totalSurcharge).toLocaleString()}.`,
    impactedYears: remainingYears.map(y => y.year),
    totalSurchargeOverWindow: totalSurcharge,
  };
};
