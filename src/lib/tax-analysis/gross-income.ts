import type { TaxReturnFacts } from "@/lib/schemas/tax-return-facts";

/**
 * Gross income — what the household actually took in, before basis recovery
 * and before business/rental expenses.
 *
 * 1040 line 9 is a NET figure dressed as a top line. A rental that collected
 * $19,600 and depreciated $8,413 lands on line 9 as a $6,141 LOSS, so a return
 * whose owner banked real rent reports a *smaller* total income than one with
 * no rental at all. The same silent netting happens at 4a/4b (basis recovery),
 * 5a/5b (exclusion ratio) and 6a/6b (the §86 partial exclusion): the return
 * prints both numbers precisely because they answer different questions, and
 * only the taxable one reaches line 9.
 *
 * Gross income restores the "a"-line reading. It is line 9 with each activity's
 * net swapped for its gross basis — never a sum of components. Anchoring on the
 * filed total means the figure can only differ from the return by uplifts we can
 * point at, the same rule `incomeCompositionTotal` follows.
 *
 * Deliberately EXCLUDED:
 *  - Tax-exempt interest (2a). Real cash, but a §103 exclusion is not gross
 *    income, and it has no line-9 counterpart to swap. It belongs in a cash
 *    view, not here.
 *  - K-1 boxes. A K-1 box is already an allocated net and the entity's own
 *    gross receipts never appear on the 1040 — box 1 IS the gross basis
 *    available to this return.
 *  - Wages (1a). Already the gross W-2 total. Elective deferrals are excluded
 *    from box 1 but are not extracted, so there is nothing to add back.
 */

export interface GrossUplift {
  /** The `IncomeCompositionRow` key whose net this replaces. */
  key: string;
  /** What the activity took in. */
  gross: number;
  /** The net for the same activity that sits inside 1040 line 9. */
  net: number;
}

export interface GrossIncome {
  /** Line 9 plus every uplift. Null when line 9 wasn't extracted — we never
   *  pass a summed-rows figure off as a total. */
  total: number | null;
  /** Only activities whose gross actually differs from their net. A zero uplift
   *  would light the Gross column up to say nothing. */
  uplifts: GrossUplift[];
}

type Income = TaxReturnFacts["income"];

/** The 1040's own gross/taxable pairs, in line order. Getters rather than key
 *  names for the same reason `INCOME_ROWS` uses them — the field types stay
 *  checked instead of being cast back out of a `keyof` lookup. */
const AB_PAIRS: Array<{ key: string; gross: (i: Income) => number | null; net: (i: Income) => number | null }> = [
  { key: "ira", gross: (i) => i.iraDistributionsGross, net: (i) => i.iraDistributionsTaxable },
  { key: "pensions", gross: (i) => i.pensionsGross, net: (i) => i.pensionsTaxable },
  { key: "socialSecurity", gross: (i) => i.ssBenefitsGross, net: (i) => i.ssBenefitsTaxable },
];

/** Schedule C gross receipts, summed across every business on the return.
 *  Null unless EVERY business carries one: a partial sum gets paired against
 *  the full `scheduleCNet`, which understates gross — and for a profitable
 *  business produces a "gross" that sits below line 9. */
function scheduleCGross(facts: TaxReturnFacts): number | null {
  if (facts.businesses.length === 0) return null;
  let sum = 0;
  for (const b of facts.businesses) {
    if (b.grossReceipts == null) return null;
    sum += b.grossReceipts;
  }
  return sum;
}

export function buildGrossIncome(facts: TaxReturnFacts): GrossIncome {
  const income = facts.income;
  const candidates: Array<{ key: string; gross: number | null; net: number | null }> = [
    ...AB_PAIRS.map((p) => ({ key: p.key, gross: p.gross(income), net: p.net(income) })),
    { key: "business", gross: scheduleCGross(facts), net: income.scheduleCNet },
    { key: "rental", gross: income.scheduleE?.grossRents ?? null, net: income.scheduleENet },
  ];

  const uplifts = candidates.filter(
    (c): c is GrossUplift => c.gross != null && c.net != null && c.gross !== c.net,
  );

  const total =
    income.totalIncome == null
      ? null
      : uplifts.reduce((sum, u) => sum + (u.gross - u.net), income.totalIncome);

  return { total, uplifts };
}

/** Gross basis for one income-composition row: its uplift when it has one,
 *  otherwise the filed amount itself. */
export function grossForKey(gross: GrossIncome, key: string, amount: number): number {
  return gross.uplifts.find((u) => u.key === key)?.gross ?? amount;
}
