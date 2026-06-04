// Gift Tax drill — mirrors the in-app Gift Tax tab. Table-only (no chart).
// Reads ProjectionResult.giftLedger directly. Per-spouse column groups use the
// clients' real first names; spouse group omitted when there is no spouse.

import type { DrillColumn, DrillPageData, DrillRow } from "../../shared/drill-types";
import { filterYearsToRange, type RangeOption } from "../../shared/year-filter";
import { buildMarkers } from "../../shared/markers";
import {
  ESTATE_DISCLAIMER, estateCallout, parseBirthYear, type EstateDrillInput,
} from "../estate-shared";

export function buildGiftTaxDrillData(input: EstateDrillInput): DrillPageData {
  const { projection, clientData, options, scenarioLabel, clientName, spouseName } = input;
  const ledger = projection.giftLedger ?? [];

  const visibleYears = filterYearsToRange(projection.years, options.range as RangeOption);
  const visibleSet = new Set(visibleYears.map((y) => y.year));
  const ledgerRows = ledger.filter((g) => visibleSet.has(g.year));

  const hasSpouse = spouseName != null && ledgerRows.some((g) => g.perGrantor.spouse != null);
  const clientLabel = clientName;
  const spouseLabel = spouseName ?? "Spouse";

  const columns: DrillColumn[] = [
    { key: "giftsGiven",         header: "Gifts\nGiven",            width: 48 },
    { key: "taxableGiftsGiven",  header: "Taxable\nGifts",          width: 48 },
    { key: "clientCumulGifts",   header: `${clientLabel}\nCumul. Gifts`,    width: 48 },
    { key: "clientCreditUsed",   header: `${clientLabel}\nCredit Used`,     width: 48 },
    { key: "clientGiftTax",      header: `${clientLabel}\nGift Tax`,        width: 44 },
    { key: "clientCumulGiftTax", header: `${clientLabel}\nCumul. Tax`,      width: 48 },
    ...(hasSpouse
      ? [
          { key: "spouseCumulGifts",   header: `${spouseLabel}\nCumul. Gifts`, width: 48 },
          { key: "spouseCreditUsed",   header: `${spouseLabel}\nCredit Used`,  width: 48 },
          { key: "spouseGiftTax",      header: `${spouseLabel}\nGift Tax`,     width: 44 },
          { key: "spouseCumulGiftTax", header: `${spouseLabel}\nCumul. Tax`,   width: 48 },
        ]
      : []),
    { key: "giftTax", header: "Gift\nTax", width: 48, strong: true },
  ];

  const clientBirthYear = parseBirthYear(clientData.client.dateOfBirth ?? null);
  const spouseBirthYear = parseBirthYear(clientData.client.spouseDob ?? null);

  const rows: DrillRow[] = ledgerRows.map((g) => {
    const c = g.perGrantor.client;
    const s = g.perGrantor.spouse;
    const cells: Record<string, number> = {
      giftsGiven: g.giftsGiven,
      taxableGiftsGiven: g.taxableGiftsGiven,
      clientCumulGifts: c.cumulativeTaxableGifts,
      clientCreditUsed: c.creditUsed,
      clientGiftTax: c.giftTaxThisYear,
      clientCumulGiftTax: c.cumulativeGiftTax,
      giftTax: g.totalGiftTax,
    };
    if (hasSpouse && s) {
      cells.spouseCumulGifts = s.cumulativeTaxableGifts;
      cells.spouseCreditUsed = s.creditUsed;
      cells.spouseGiftTax = s.giftTaxThisYear;
      cells.spouseCumulGiftTax = s.cumulativeGiftTax;
    }
    return {
      year: g.year,
      ageClient: clientBirthYear != null ? g.year - clientBirthYear : null,
      ageSpouse: spouseBirthYear != null ? g.year - spouseBirthYear : null,
      cells,
    };
  });

  const markers = buildMarkers(clientData, visibleYears, clientName, spouseName);

  return {
    title: "Gift Tax",
    subtitle: scenarioLabel,
    callout: estateCallout(options),
    // No chart — table-only, like Portfolio Growth/Activity.
    table: { columns, rows, markers },
    footnote: ESTATE_DISCLAIMER,
  };
}
