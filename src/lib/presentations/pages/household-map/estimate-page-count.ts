// Data-independent, per the page-count convention — `document.tsx` calls these
// during layout planning, before any data exists. Each board targets one
// landscape (Net Worth, Cash Flow) or portrait (Goals) page; a household with a
// long account list or many goals wraps to a second physical page at render
// time, which shifts the printed footer numbering the same way every other
// wrapping page in the deck already does.

export function estimateMapNetWorthPageCount(): number {
  return 1;
}

export function estimateMapCashFlowPageCount(): number {
  return 1;
}

export function estimateMapGoalsPageCount(): number {
  return 1;
}
