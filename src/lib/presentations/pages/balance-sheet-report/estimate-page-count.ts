// How many sheets the deck's Balance Sheet page prints. The page flows — a long
// household's table runs on over as many sheets as it needs — and the deck's
// Contents numbers every later page from this count, so it lays the sheet out
// the way react-pdf does: rows stack until one no longer fits, and that row
// starts the next sheet. Heights are the printed rows' own, measured off a
// render (Inter: one line is 1.21 × its size); `estimate-page-count.test.tsx`
// renders the real page and holds this to the sheet count it produces.
import type { BalanceSheetPdfView } from "@/components/balance-sheet-report-pdf/balance-sheet-pdf-document";
import type { OwnerColumnRow } from "@/components/balance-sheet-report/household-columns";
import { groupBeneficiaries, hasTrustDetails, type TrustDetails } from "@/lib/balance-sheet/trust-details";
import { isTrust } from "@/lib/balance-sheet/entity-groups";
import type { BalanceSheetReportPageData } from "./view-model";

/** One line of text at `size` points. */
const line = (size: number) => size * 1.21;

/** A sheet's flow box: under the repeating frame header, above the footer band. */
const SHEET_PT = 634.8;
/** The section head, first sheet only. */
const HEAD_PT = 37.6;
const PANEL_BORDER = 1;
const PANEL_GAP = 12;
const ROW = 0.5 + 7 + line(9);
const CATEGORY_ROW = 0.5 + 7 + line(10);
const HEADER_ROW = 10 + line(7);
const TOTAL_ROW = 1.2 + 10 + line(9);
const MARGIN_LOAN_LINE = 1 + line(7);
/** Inter averages about this per character of an account name, per point of size. */
const CHAR_EM = 4.9 / 9;
/** The width a name gets beside its number columns. */
const NAME_PT = { split: 178, single: 334, entity: 186 };
/** Trust Details: a value's width beside its label, and the powers' chip row. */
const DETAIL_PT = { value: 150, chips: 160 };

const textWidth = (text: string, size: number) => text.length * CHAR_EM * size;

function textLines(text: string, widthPt: number): number {
  return Math.max(1, Math.ceil(textWidth(text, 9) / widthPt));
}

/** An account's row: its 9pt name, then its 7pt badges running on after it —
 *  a line that holds only badge text is a 7pt line. */
function accountRow(name: string, widthPt: number, opts: { badges?: string; marginLoan?: number } = {}): number {
  const nameLines = textLines(name, widthPt);
  const lines = Math.max(nameLines, Math.ceil((textWidth(name, 9) + textWidth(opts.badges ?? "", 7)) / widthPt));
  return (
    ROW +
    (nameLines - 1) * line(9) +
    (lines - nameLines) * line(7) +
    ((opts.marginLoan ?? 0) > 0 ? MARGIN_LOAN_LINE : 0)
  );
}

/** Lines the trust powers' chips wrap onto: each is its 6.5pt uppercase label
 *  plus padding and border. */
function chipLines(powers: string[]): number {
  let lines = 1;
  let width = 0;
  for (const p of powers) {
    const w = p.length * 4.4 + 12;
    if (width > 0 && width + w > DETAIL_PT.chips) {
      lines += 1;
      width = 0;
    }
    width += w;
  }
  return lines;
}

/** Stacks blocks onto sheets: one that does not fit where it would start moves
 *  whole to the next, taking the gap above it along. */
function sheetsFor(heights: number[]): number {
  let sheets = 1;
  let used = HEAD_PT;
  for (const h of heights) {
    // react-pdf's own tolerance, so a row ending flush at the bottom stays put.
    if (used + h > SHEET_PT + 0.001) {
      sheets += 1;
      used = 0;
    }
    used += h;
  }
  return sheets;
}

function householdHeights(view: Extract<BalanceSheetPdfView, { kind: "household" }>) {
  const { household, donut, outOfEstate } = view;
  const split = household.hasSpouse && view.spouseLabel != null;
  const namePt = split ? NAME_PT.split : NAME_PT.single;
  const slices = donut.filter((s) => s.value > 0).length;

  // Pie (or its legend, if longer) beside the Net Worth Summary's owner rows.
  const pieSide = slices === 0 ? 40 + line(9) : Math.max(96, slices * (line(9) + 3));
  const ownerSide = 3 + line(6) + (split ? 4 : 2) * (0.5 + 6 + line(9));
  const summary = 2 * PANEL_BORDER + 20 + line(7) + 8 + Math.max(pieSide, ownerSide);

  const row = (r: OwnerColumnRow) =>
    accountRow(r.name, namePt, {
      badges: `${r.hasLinkedMortgage ? "  (M)" : ""}${r.revocableTrustName ? `  ·  ${r.revocableTrustName}` : ""}`,
      marginLoan: r.marginLoan,
    });
  const heights = [
    summary + PANEL_GAP,
    PANEL_BORDER + HEADER_ROW,
    ...household.assetCategories.flatMap((cat) => [CATEGORY_ROW, ...cat.rows.map(row)]),
    TOTAL_ROW,
    ...(household.liabilityRows.length > 0 ? [CATEGORY_ROW, ...household.liabilityRows.map(row)] : []),
    TOTAL_ROW,
    TOTAL_ROW + PANEL_BORDER,
  ];
  const ooe = outOfEstate.outOfEstateOwnerRows.length;
  if (ooe > 0) heights.push(PANEL_GAP + 2 * PANEL_BORDER + HEADER_ROW + ooe * ROW + TOTAL_ROW);
  return heights;
}

function trustDetailsHeight(d: TrustDetails): number {
  const detailLine = (n: number) => n * line(9) + 4;
  let body = 16;
  if (d.trustee) body += detailLine(textLines(d.trustee, DETAIL_PT.value));
  if (d.grantor) body += detailLine(textLines(d.grantor, DETAIL_PT.value));
  if (d.powers.length > 0) body += Math.max(line(9), chipLines(d.powers) * (line(6.5) + 5)) + 4;
  for (const g of groupBeneficiaries(d)) body += 4 + line(7) + 2 + g.rows.length * (line(9) + 1.5);
  return 2 * PANEL_BORDER + 12 + line(9) + body;
}

function entityHeights(view: Extract<BalanceSheetPdfView, { kind: "entities" }>) {
  if (view.groups.length === 0) return [8 + line(9)];
  const details = new Map(view.trustDetails.map((d) => [d.entityId, d]));
  return view.groups.map((g, i) => {
    const card =
      2 * PANEL_BORDER +
      12 +
      line(9) +
      g.assetRows.reduce((sum, r) => sum + accountRow(r.accountName, NAME_PT.entity, { marginLoan: r.marginLoan }), 0) +
      g.liabilityRows.reduce((sum, r) => sum + accountRow(r.liabilityName, NAME_PT.entity), 0);
    const d = isTrust(g) ? details.get(g.entityId) : undefined;
    return (i > 0 ? PANEL_GAP : 0) + Math.max(card, d && hasTrustDetails(d) ? trustDetailsHeight(d) : 0);
  });
}

export function estimateBalanceSheetReportPageCount(data?: BalanceSheetReportPageData): number {
  if (!data) return 1;
  return sheetsFor(data.view.kind === "household" ? householdHeights(data.view) : entityHeights(data.view));
}
