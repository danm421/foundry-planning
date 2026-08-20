// Always one sheet: six cards two-up is three rows. The picker caps the advisor
// at six for exactly this reason — `render-smoke.test.tsx` measures the fullest
// version against real PDF geometry rather than trusting the arithmetic.
export function estimateEarlyYearsTidbitsPageCount(): number {
  return 1;
}
