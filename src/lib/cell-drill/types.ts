export interface CellDrillRow {
  id: string;
  label: string;
  amount: number;
  meta?: string;
}

export interface CellDrillGroup {
  label?: string;
  rows: CellDrillRow[];
  /** When set, the modal renders a horizontal rule between rows[boundaryIndex - 1]
   *  and rows[boundaryIndex]. Used by the bracket-stacking adapter to mark the
   *  marginal bracket's lower boundary. */
  boundaryIndex?: number;
}

export interface CellDrillProps {
  title: string;
  subtitle?: string;
  total: number;
  /** Footer label for `total`. Adapters set this when `total` is NOT the sum
   * of the rows (e.g. bracket-stacking, where it is the marginal-bracket amount).
   * Defaults to "Total" in the modal. */
  totalLabel?: string;
  groups: CellDrillGroup[];
  footnote?: string;
}
