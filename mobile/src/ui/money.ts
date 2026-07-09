// mobile/src/ui/money.ts
//
// Currency formatting shared across Home dashboard tiles.

export function formatMoney(n: number, opts?: { cents?: boolean }): string {
  const cents = opts?.cents ?? false;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  }).format(n);
}
