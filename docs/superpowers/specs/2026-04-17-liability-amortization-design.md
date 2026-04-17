# Liability Amortization & Extra Payments

## Summary

Transform the liability data entry experience from a flat form into a tabbed
loan calculator with a full amortization schedule. Advisors see the year-by-year
payment breakdown (interest, principal, ending balance), add extra payments
(per-payment additions or lump sums), and watch a live line graph update to show
the impact on total interest and payoff timeline. Extra payments flow through to
the cash flow projection as additional outflows.

## Motivation

The current liability form captures a balance, rate, and monthly payment — enough
to model flat debt service in the projection, but it gives advisors no visibility
into how the loan amortizes or what accelerated payoff looks like. This is table
stakes for mortgage and loan planning conversations.

---

## Schema Changes

### Liabilities Table Modifications

Add two columns, drop two:

| Action | Column | Type | Notes |
|--------|--------|------|-------|
| ADD | `term_months` | integer, not null | Loan term in months (e.g., 360 for 30-year) |
| ADD | `term_unit` | enum `'monthly' \| 'annual'` | Display preference only; storage is always months. Annual input × 12 on write |
| DROP | `end_year` | — | Derived: `startYear + Math.ceil(termMonths / 12)` |
| DROP | `end_year_ref` | — | Liabilities use contractual terms, not milestone references |

### New `extra_payments` Table

```
extra_payments
├── id              uuid, PK, default gen_random_uuid()
├── liability_id    uuid, FK → liabilities(id), ON DELETE CASCADE
├── year            integer, NOT NULL
├── type            enum 'per_payment' | 'lump_sum'
├── amount          decimal(15,2), NOT NULL
├── created_at      timestamp, default now()
└── updated_at      timestamp, default now()
```

Unique constraint on `(liability_id, year, type)` — one per-payment addition and
one lump sum per liability per year.

### Migration

Single migration:

1. Add `term_months` and `term_unit` columns (nullable initially).
2. Backfill `term_months` from existing data: `(end_year - start_year) * 12`.
   Set `term_unit` to `'annual'` for all existing rows.
3. Make `term_months` NOT NULL.
4. Drop `end_year` and `end_year_ref` columns.
5. Create `extra_payments` table.
6. Create `extra_payment_type` enum.

---

## Engine Changes

### Types

```typescript
export interface ExtraPayment {
  id: string;
  liabilityId: string;
  year: number;
  type: 'per_payment' | 'lump_sum';
  amount: number;
}

export interface Liability {
  id: string;
  name: string;
  balance: number;
  interestRate: number;
  monthlyPayment: number;
  startYear: number;
  termMonths: number;
  linkedPropertyId?: string;
  ownerEntityId?: string;
  isInterestDeductible?: boolean;
  extraPayments: ExtraPayment[];
}
```

`endYear` is computed: `startYear + Math.ceil(termMonths / 12)`.

### `amortizeLiability()` Updates

Current signature returns `AmortizationResult` for a single year. Updated
behavior:

- Accept the liability's `extraPayments` array.
- For each year, look up extra payments for that year.
- **Per-payment addition:** multiply `amount × 12` (monthly payments per year),
  add to that year's total payment before splitting interest/principal.
- **Lump sum:** add as a one-time principal reduction after the regular
  payment is applied.
- If extra payments cause the balance to reach zero before the contractual end,
  the final year's payment is capped at the remaining balance + interest owed.
  Subsequent years return all zeros.
- Interest portion: `balance × interestRate` (annual, computed on beginning-of-year
  balance — unchanged from current behavior).
- Principal portion: `totalPayment − interestPortion + lumpSum`.

### `computeLiabilities()` Updates

- Load extra payments alongside liabilities from the projection input.
- Pass them through to `amortizeLiability()`.
- Extra payment amounts are included in the liability's total annual cash outflow
  so they flow into `expenses.liabilities` and the cash routing logic.

### `deriveMortgageInterestFromLiabilities()` Updates

- No structural change — interest portion already comes from amortization. The
  updated amortization math (which accounts for extra payments reducing balance
  faster) will naturally produce lower interest amounts in later years.

---

## Client-Side Loan Calculator

Three calculate buttons next to Term, Payment, and Interest Rate fields. Each
is enabled when the other two fields plus balance are filled.

### Formulas

**Payment from balance/rate/term:**

```
r = monthlyRate = annualRate / 12
n = termMonths
P = balance × r × (1 + r)^n / ((1 + r)^n − 1)
```

**Term from balance/rate/payment:**

```
r = monthlyRate
n = Math.ceil(−ln(1 − balance × r / payment) / ln(1 + r))
```

Returns `Infinity` / shows error if payment ≤ balance × monthlyRate (payment
doesn't cover interest).

**Interest rate from balance/term/payment (Newton-Raphson):**

```
f(r) = balance × r × (1 + r)^n / ((1 + r)^n − 1) − payment
f'(r) = derivative of the above

Iterate: r_{k+1} = r_k − f(r_k) / f'(r_k)
Initial guess: r_0 = 0.005 (6% annual)
Converge when |f(r)| < 0.01, max 100 iterations
Result: annualRate = r × 12
```

All three run client-side. Extracted into a shared `loan-math.ts` utility so
the engine and the UI use the same formulas.

---

## API Changes

### Liabilities Endpoints

Update existing `POST` and `PUT` handlers:

- Accept `termMonths` and `termUnit` instead of `endYear` / `endYearRef`.
- Remove `endYear` / `endYearRef` from request/response shapes.

### Extra Payments Endpoints

```
GET    /api/clients/[id]/liabilities/[liabilityId]/extra-payments
POST   /api/clients/[id]/liabilities/[liabilityId]/extra-payments
PUT    /api/clients/[id]/liabilities/[liabilityId]/extra-payments/[extraPaymentId]
DELETE /api/clients/[id]/liabilities/[liabilityId]/extra-payments/[extraPaymentId]
```

Standard CRUD following the existing pattern. All require firm authorization.

### Projection Data Endpoint

Include extra payments when loading liabilities for projection input — join
`extra_payments` on `liability_id` and nest into the liability objects.

---

## UI Changes

### Liability Dialog → Tabbed View

The existing `AddLiabilityDialog` becomes a tabbed experience:

**Details Tab** (the form, reorganized top-to-bottom):

1. Name
2. Balance
3. Start year (with `MilestoneYearPicker`)
4. Term + unit toggle (months/years) + ⚙ calculate button
5. Interest rate (%) + ⚙ calculate button
6. Monthly payment + ⚙ calculate button
7. Linked property (dropdown, optional)
8. Owner entity (dropdown, optional)
9. Interest deductible (checkbox)

Calculate buttons are small icon buttons (calculator icon). Each is enabled only
when the other two fields in the trio (term, rate, payment) plus balance are
filled. Clicking computes and fills the field.

**Amortization Tab** (edit mode only — requires a saved liability):

Top section: **Line graph** (Chart.js, matching existing project patterns)
- X-axis: year
- Two lines: cumulative principal paid, cumulative interest paid
- Updates live when extra payments are added/changed/removed
- Responsive, same styling as the cash flow chart

Bottom section: **Amortization schedule table**

| Year | Payment | Interest | Principal | Extra Payment | Ending Balance |
|------|---------|----------|-----------|---------------|----------------|

- One row per year from `startYear` to payoff (or contractual end)
- "Extra Payment" column is interactive: click to add/edit a per-payment
  addition or lump sum for that year (inline popover or small form)
- Rows after early payoff are grayed out or hidden
- Summary row at bottom: totals for payment, interest, principal, extra payments

The table and graph share the same computed schedule — a single
`computeAmortizationSchedule(liability, extraPayments)` function that returns
the full year-by-year array. This runs client-side for instant feedback.

### Balance Sheet View

No changes — liabilities panel continues to show name, balance, and interest
rate. The amortization detail lives inside the edit dialog.

### Import Wizard

No changes needed — the review step can continue to capture balance, rate,
payment, start year. Term can default to 360 months (30-year) for imported
liabilities; the advisor adjusts in the edit dialog.

---

## Testing

### Engine Tests

- Amortization with no extra payments matches current behavior (regression)
- Per-payment addition reduces total interest and shortens payoff
- Lump sum in a specific year reduces balance and subsequent interest
- Combined per-payment + lump sum in the same year
- Extra payments that cause early payoff (balance hits zero before term ends)
- Edge cases: zero interest rate, payment exactly covers interest (never pays off),
  single-year term

### Calculator Tests

- Payment calculation matches known amortization tables
- Term calculation round-trips with payment calculation
- Interest rate solver converges for typical mortgage parameters
- Edge case: payment too low to cover interest → term returns error

### API Tests

- CRUD for extra payments with firm authorization
- Extra payments cascade-delete when liability is deleted
- Projection data endpoint includes extra payments

---

## Scope Boundaries

**In scope:**
- Schema migration (term columns, extra_payments table)
- Engine updates (amortization with extra payments)
- Loan calculator (three-way solve, client-side)
- Tabbed liability dialog (Details + Amortization)
- Line graph and schedule table with live updates
- Extra payments CRUD API
- Projection integration (extra payments as cash outflows)

**Out of scope:**
- Variable interest rates
- Balloon payments
- Prepayment penalties
- ARM adjustment schedules
- Amortization export/PDF
- Changes to the deductions page (mortgage interest derivation works
  automatically from the updated amortization math)
