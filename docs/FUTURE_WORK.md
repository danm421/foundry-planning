# Future Work

Lightweight running list of items deferred from past sessions. Add a new entry
when you consciously scope something out; remove the entry when it ships.
Format: one line per item plus a short "Why deferred" note.

Items are scored on three axes:

- **P (Priority)** 1–10: how important/urgent
- **E (Ease)** 1–10: how easy to implement (10 = few hours)
- **L (Leverage)** 1–10: how much other work this unlocks

Items are grouped by category in [`docs/future-work/`](future-work/):

- [Client Data](future-work/client-data.md)
- [UI](future-work/ui.md)
- [Engine](future-work/engine.md)
- [Analytics](future-work/analytics.md)
- [Reports](future-work/reports.md)
- [Integrations](future-work/integrations.md)
- [Schema](future-work/schema.md)
- [Tooling](future-work/tooling.md)
- [Security Hardening](future-work/security-hardening.md)
- [Timeline Report](future-work/timeline-report.md)
- [Monte Carlo v2](future-work/monte-carlo-v2.md)

## Suggested Order

Filtered to P ≥ 4 and sorted by P+E+L. Items below this cutoff are genuinely
backlog; some of them (family members as owners, per-entity tax fields) are
enablers and should ship folded into their parent feature.

| # | Item | P | E | L | Total |
|---|------|---|---|---|-------|
| 1 | Scenario switcher + side panel | 9 | 2 | 8 | 19 |
| ~~2~~ | ~~Asset mix tab on investment accounts~~ | — | — | — | SHIPPED |
| 3 | Roth conversion optimizer (now unblocked) | 7 | 5 | 5 | 17 |
| 4 | Year-by-year schedule for incomes & expenses | 7 | 5 | 4 | 16 |
| ~~5~~ | ~~Investments report (asset allocation)~~ | — | — | — | SHIPPED |
| 6 | Assumption library | 4 | 6 | 6 | 16 |
| 7 | Monte Carlo / probability of success | 8 | 4 | 3 | 15 |
| 8 | UI/UX refresh for Income/Expenses/Savings tabs | 6 | 5 | 4 | 15 |
| 9 | Amortization table + extra payments on liabilities | 6 | 5 | 4 | 15 |
| 10 | Asset allocation extraction from statements | 6 | 4 | 5 | 15 |
| 11 | Plan PDF export | 5 | 6 | 4 | 15 |
| 12 | CSV export for reports (cross-cutting) | 5 | 7 | 3 | 15 |
| 13 | Per-year ledger drill-in for tax tables | 6 | 5 | 3 | 14 |
| 14 | SS claiming optimizer (Tier 3 — depends on Tier 1+2 shipping) | 5 | 6 | 2 | 13 |
| 15 | Client-facing read-only view | 4 | 6 | 3 | 13 |
| 16 | Trust/estate brackets (data ready) | 4 | 7 | 2 | 13 |
| 17 | Trust taxes for non-grantor entities | 5 | 4 | 3 | 12 |
| 18 | IRMAA tiers in tax engine | 5 | 4 | 3 | 12 |
| 19 | Estate planning report | 7 | 2 | 3 | 12 |
| 20 | Plan vs actual tracking | 4 | 4 | 3 | 11 |
| 21 | State-level bracket tax | 5 | 2 | 4 | 11 |

Dependency notes that override raw score:

- Ship **deduction types before the Roth optimizer** — the optimizer needs
  real above-line deductions to honestly compute "how much bracket room is left."
- Ship **family members as owners before estate report** (enabler, P3/L6).
- Start the **scenario switcher design doc** in parallel with other work — it's
  the biggest lift and benefits from early design pressure.
- **Trust/estate brackets** are a tiny add since the data is already in the
  seed workbook; they unlock the **trust taxes for non-grantor** work.
- **Year-by-year schedules + Amortization/extra payments + UI refresh** all
  touch the Income/Expenses/Savings/Liabilities forms — ship as one
  coherent Client Data refresh once we're ready to revisit those tabs.
- ~~Ship **asset mix tab before Investments report**~~ — DONE. Asset mix
  tab shipped; **Investments report** and **asset allocation extraction**
  are now unblocked.
