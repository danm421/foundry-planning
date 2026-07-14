// mobile/src/recurrings/logic.ts
//
// Pure, dependency-free port of the recurrings sort/label/rule-chip logic
// from the web portal. No react, no api imports — strings/arrays in,
// strings/arrays out.
//
// Sources ported (web portal):
//   - src/components/portal/recurrings-view.tsx
//       STATE_ORDER (line 16), dueLabel (lines 19-23), the row's overdue
//       ternary + cadence label (lines 99-101, 108)
//   - src/lib/portal/recurring-matching.ts
//       describeRules (lines 250-270) -> ported as ruleChips, along with its
//       private helpers ordinal/fmtWhole/MONTH_NAMES (lines 97-118)
import type { RecurringRowDTO } from "@contracts";

const STATE_ORDER: Record<RecurringRowDTO["state"], number> = { overdue: 0, due: 1, paid: 2 };

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Stable sort: overdue -> due -> paid. Array.prototype.sort is stable per
 *  spec, matching the web's `[...data.recurrings].sort(...)`. Does not
 *  mutate the input. */
export function sortRecurrings(rows: RecurringRowDTO[]): RecurringRowDTO[] {
  return [...rows].sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state]);
}

/** Verbatim port of the web's dueLabel(r, month) PLUS the row's overdue
 *  ternary that wraps it (recurrings-view.tsx:99-101: `r.state === "overdue"
 *  ? "Overdue" : dueLabel(r, data.month)`), folded into one function since
 *  RecurringRowDTO already carries `state`. "paid" is not special-cased on
 *  the web — it renders the same due-date label as "due". */
export function dueLabel(r: RecurringRowDTO, month: string): string {
  if (r.state === "overdue") return "Overdue";
  const mAbbr = MONTH_ABBR[Number(month.slice(5, 7)) - 1];
  if (r.cadence === "monthly") return r.dueDay ? `${mAbbr} ${r.dueDay}` : "Anytime";
  return r.dueMonth ? MONTH_ABBR[r.dueMonth - 1] : "Yearly";
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

function fmtWhole(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

/** Port of describeRules (src/lib/portal/recurring-matching.ts:250-270). */
export function ruleChips(r: RecurringRowDTO): string[] {
  const chips: string[] = [];
  chips.push(r.matchType === "exact" ? `Named exactly ${r.pattern}` : `Named ${r.pattern}`);
  chips.push(`from ${fmtWhole(r.amountMin)} to ${fmtWhole(r.amountMax)}`);
  if (r.cadence === "monthly") {
    chips.push(r.dueDay == null ? "anytime in the month" : `around the ${ordinal(r.dueDay)}`);
    chips.push("every month");
  } else {
    if (r.dueMonth != null) chips.push(`in ${MONTH_NAMES[r.dueMonth - 1]}`);
    chips.push("every year");
  }
  return chips;
}

/** Mirrors the web list row's cadence text (recurrings-view.tsx:108):
 *  `{r.cadence === "monthly" ? "Monthly" : "Annually"}` — no due-day/month
 *  qualifier is rendered there despite that being the natural read of "list
 *  row cadence qualifier"; verified against the actual JSX. */
export function cadenceLabel(r: RecurringRowDTO): string {
  return r.cadence === "monthly" ? "Monthly" : "Annually";
}
