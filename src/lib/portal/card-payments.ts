// Pure: which credit-card payments should be typed 'transfer'. NO DB/Next
// imports (mirrors budget-summary.ts).
//   - Money INTO a linked card is never spending → always a transfer.
//   - The paying side (checking, +X) is a transfer only when it pairs with a
//     payment into a linked card. Unpaired, it is the only trace of an unlinked
//     card's purchases, so it stays spending.
import type { TransactionType } from "@/lib/portal/pfc-mapping";

export type CardPaymentRow = {
  id: string;
  plaidAccountId: string | null;
  amount: number; // Plaid sign: positive = money out
  date: string; // YYYY-MM-DD
  type: TransactionType;
  pfcPrimary: string | null;
  pfcDetailed: string | null;
};

const PAIR_WINDOW_DAYS = 5; // ACH over a weekend + holiday

const cents = (n: number) => Math.round(n * 100);
const dayNumber = (ymd: string) => Date.parse(`${ymd}T00:00:00Z`) / 86_400_000;

/** Ids of rows currently typed 'expense' that should be 'transfer'. */
export function cardPaymentTransferIds(
  rows: CardPaymentRow[],
  cardPlaidAccountIds: ReadonlySet<string>,
): string[] {
  const onCard = (r: CardPaymentRow) =>
    r.plaidAccountId != null && cardPlaidAccountIds.has(r.plaidAccountId);
  const received = rows.filter(
    (r) =>
      onCard(r) && r.amount < 0 && (r.pfcPrimary === "LOAN_PAYMENTS" || r.pfcPrimary === "TRANSFER_IN"),
  );
  // Any loan detail: Plaid files some autopays as LOAN_PAYMENTS_OTHER_PAYMENT,
  // and the exact-amount pairing is what proves it paid a card.
  const paid = rows.filter((r) => !onCard(r) && r.amount > 0 && r.pfcPrimary === "LOAN_PAYMENTS");

  // Every same-amount pair in the window, closest first, then claim one-to-one.
  const candidates: { p: CardPaymentRow; r: CardPaymentRow; gap: number }[] = [];
  for (const p of paid) {
    for (const r of received) {
      const gap = Math.abs(dayNumber(r.date) - dayNumber(p.date));
      if (cents(-r.amount) === cents(p.amount) && gap <= PAIR_WINDOW_DAYS) {
        candidates.push({ p, r, gap });
      }
    }
  }
  candidates.sort((a, b) => a.gap - b.gap);

  const ids = received.filter((r) => r.type === "expense").map((r) => r.id);
  const claimed = new Set<string>();
  for (const { p, r } of candidates) {
    if (claimed.has(p.id) || claimed.has(r.id)) continue;
    claimed.add(p.id);
    claimed.add(r.id);
    if (p.type === "expense") ids.push(p.id);
  }
  return ids;
}
