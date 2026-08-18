"use client";

import { useState, useTransition } from "react";
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  createColumnHelper,
} from "@tanstack/react-table";
import { FieldTooltip } from "@/components/forms/field-tooltip";
import { createPromoCodeAction, deactivatePromoCodeAction } from "./actions";
import type { PromoCodeRow, PromoCodeStatus } from "@/lib/billing/promo-codes";

const STATUS_STYLE: Record<PromoCodeStatus, string> = {
  active: "bg-good/15 text-good",
  expired: "bg-warn/15 text-warn",
  "used up": "bg-warn/15 text-warn",
  inactive: "bg-card-2 text-ink-3",
};

const INPUT =
  "rounded border border-hair-2 bg-card-2 px-2.5 py-1.5 text-ink placeholder:text-ink-4 focus:border-accent focus:outline-none";

function fmt(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Label + optional help badge above a control. The `?` badge sits *beside* the
 * `<label>` rather than inside it — a button nested in a label steals the
 * label's association, so the control itself would stop being named.
 */
function Field({
  id,
  label,
  help,
  children,
}: {
  id: string;
  label: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5 text-sm">
      <span className="flex items-center gap-1.5">
        <label htmlFor={id} className="text-ink-2">
          {label}
        </label>
        {help && <FieldTooltip text={help} />}
      </span>
      {children}
    </div>
  );
}

export default function PromoCodesClient({
  initialCodes,
  truncated,
  loadError,
}: {
  initialCodes: PromoCodeRow[];
  truncated: boolean;
  loadError: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [created, setCreated] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [discountKind, setDiscountKind] = useState<"percent" | "amount">("percent");
  const [percentOff, setPercentOff] = useState("25");
  const [amountOffDollars, setAmountOffDollars] = useState("50");
  const [years, setYears] = useState(1);
  const [maxRedemptions, setMaxRedemptions] = useState(25);
  const [expiresAt, setExpiresAt] = useState("");
  const [firstTimeOnly, setFirstTimeOnly] = useState(true);

  function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCreated(null);
    startTransition(async () => {
      const res = await createPromoCodeAction({
        name,
        code: code.trim() || null,
        discountKind,
        percentOff: discountKind === "percent" ? Number(percentOff) : null,
        amountOffDollars: discountKind === "amount" ? Number(amountOffDollars) : null,
        years,
        maxRedemptions,
        expiresAt: expiresAt || null,
        firstTimeOnly,
      });
      if (res.ok) {
        setCreated(res.code);
        setName("");
        setCode("");
      } else {
        setError(res.error);
      }
    });
  }

  function onDeactivate(row: PromoCodeRow) {
    if (!confirm(`Stop ${row.code} being redeemed? Buyers who already used it keep their discount.`))
      return;
    setError(null);
    startTransition(async () => {
      const res = await deactivatePromoCodeAction(row.id);
      if (!res.ok) setError(res.error);
    });
  }

  const col = createColumnHelper<PromoCodeRow>();
  const columns = [
    col.accessor("code", {
      header: "Code",
      cell: (c) => <span className="tabular text-sm text-ink">{c.getValue()}</span>,
    }),
    col.accessor("name", {
      header: "Name",
      cell: (c) => (
        <span className="flex flex-wrap items-center gap-1.5">
          {c.getValue() ?? <span className="text-ink-3">—</span>}
          {c.row.original.firstTimeOnly && (
            <span className="rounded bg-card-2 px-1.5 py-0.5 text-xs text-ink-2">New only</span>
          )}
        </span>
      ),
    }),
    col.accessor("discountLabel", {
      header: "Discount",
      cell: (c) => <span className="tabular text-xs">{c.getValue()}</span>,
    }),
    col.accessor("durationLabel", {
      header: "Lasts",
      cell: (c) => <span className="tabular text-xs">{c.getValue()}</span>,
    }),
    col.display({
      id: "uses",
      header: "Uses",
      cell: (c) => {
        const r = c.row.original;
        return (
          <span className="tabular text-xs">
            {r.timesRedeemed}
            {r.maxRedemptions == null ? " / ∞" : ` / ${r.maxRedemptions}`}
          </span>
        );
      },
    }),
    col.accessor("expiresAt", {
      header: "Expires",
      cell: (c) => <span className="tabular text-xs">{fmt(c.getValue())}</span>,
    }),
    col.accessor("status", {
      header: "Status",
      cell: (c) => (
        <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[c.getValue()]}`}>
          {c.getValue()}
        </span>
      ),
    }),
    col.display({
      id: "actions",
      header: "",
      cell: (c) => {
        const r = c.row.original;
        if (r.status === "inactive") return null;
        return (
          <button
            onClick={() => onDeactivate(r)}
            disabled={pending}
            className="text-xs text-crit hover:opacity-80 disabled:opacity-50"
          >
            Deactivate
          </button>
        );
      },
    }),
  ];

  const table = useReactTable({
    data: initialCodes,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });
  const rows = table.getRowModel().rows;

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Promo Codes</h1>
        <p className="mt-1 text-sm text-ink-2">
          Discounts buyers can type in at checkout. Stripe holds these — a code created
          here works on the pricing page straight away.
        </p>
      </header>

      {loadError && (
        <p className="rounded-lg border border-hair bg-card p-4 text-sm text-warn">
          Could not load the existing codes from Stripe: {loadError}
        </p>
      )}

      {/* Create form */}
      <section className="rounded-lg border border-hair bg-card p-5">
        <h2 className="mb-4 text-sm font-medium text-ink-2">Create a code</h2>
        <form onSubmit={onCreate}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field id="promo-name" label="Name">
              <input
                id="promo-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Founder 25"
                required
                className={INPUT}
              />
            </Field>
            <Field
              id="promo-code"
              label="Code"
              help="What the buyer types at checkout. Letters, numbers and dashes only — we uppercase it. Leave blank and Stripe generates one."
            >
              <input
                id="promo-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="FOUNDER25"
                className={`${INPUT} tabular`}
              />
            </Field>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field id="promo-kind" label="Discount type">
              <select
                id="promo-kind"
                value={discountKind}
                onChange={(e) => setDiscountKind(e.target.value as "percent" | "amount")}
                className={INPUT}
              >
                <option value="percent">Percent off</option>
                <option value="amount">Dollars off</option>
              </select>
            </Field>
            {discountKind === "percent" ? (
              <Field id="promo-percent" label="Percent off">
                <input
                  id="promo-percent"
                  type="number"
                  min={1}
                  max={100}
                  value={percentOff}
                  onChange={(e) => setPercentOff(e.target.value)}
                  className={`${INPUT} tabular`}
                />
              </Field>
            ) : (
              <Field id="promo-amount" label="Dollars off">
                <input
                  id="promo-amount"
                  type="number"
                  min={1}
                  step="0.01"
                  value={amountOffDollars}
                  onChange={(e) => setAmountOffDollars(e.target.value)}
                  className={`${INPUT} tabular`}
                />
              </Field>
            )}
            <Field
              id="promo-years"
              label="Lasts"
              help="How long the discount stays on the subscription. On the monthly plan one year is 12 discounted invoices; on the annual plan it is the first invoice, then it renews at full price."
            >
              <select
                id="promo-years"
                value={years}
                onChange={(e) => setYears(Number(e.target.value))}
                className={`${INPUT} tabular`}
              >
                {[1, 2, 3, 4, 5].map((y) => (
                  <option key={y} value={y}>
                    {y} year{y === 1 ? "" : "s"}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              id="promo-max"
              label="How many people can use it"
              help="Total redemptions across everyone. Once it is reached the code stops working; Stripe does the counting."
            >
              <input
                id="promo-max"
                type="number"
                min={1}
                max={10000}
                value={maxRedemptions}
                onChange={(e) => setMaxRedemptions(Number(e.target.value))}
                className={`${INPUT} tabular`}
              />
            </Field>
            <Field
              id="promo-expires"
              label="Last day to redeem"
              help="Optional. After this date nobody new can use the code. It does not cut short a discount already applied."
            >
              <input
                id="promo-expires"
                type="date"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                className={`${INPUT} tabular`}
              />
            </Field>
          </div>

          <label className="mt-4 flex items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={firstTimeOnly}
              onChange={(e) => setFirstTimeOnly(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-accent"
            />
            <span className="flex flex-col">
              <span className="text-ink">New customers only</span>
              <span className="text-xs text-ink-3">
                Blocks anyone who has already paid an invoice from redeeming it.
              </span>
            </span>
          </label>

          <div className="mt-5 flex items-center gap-3">
            <button
              type="submit"
              disabled={pending}
              // shrink-0: a long Stripe error alongside it must not wrap the label.
              className="shrink-0 rounded bg-accent px-4 py-2 text-sm font-medium text-accent-on hover:bg-accent-ink disabled:opacity-50"
            >
              {pending ? "Creating…" : "Create code"}
            </button>
            {error && <span className="min-w-0 break-words text-sm text-crit">{error}</span>}
          </div>
        </form>
      </section>

      {created && (
        <section className="rounded-lg border border-hair bg-card p-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-medium text-ink">
                <span className="tabular">{created}</span> is live
              </h2>
              <p className="mt-1 text-xs text-ink-2">
                Buyers enter it under &ldquo;Add promotion code&rdquo; on the checkout page.
              </p>
            </div>
            <button
              onClick={() => navigator.clipboard.writeText(created)}
              className="text-xs text-ink-2 hover:text-accent"
            >
              Copy
            </button>
          </div>
        </section>
      )}

      {/* Codes table */}
      <section>
        <h2 className="mb-3 text-sm font-medium text-ink-2">
          {truncated ? "Newest codes" : "All codes"}
          <span className="ml-2 tabular text-ink-3">({initialCodes.length})</span>
          {truncated && (
            <span className="ml-2 text-xs font-normal text-ink-3">
              — more exist in Stripe than shown here
            </span>
          )}
        </h2>
        <div className="overflow-hidden rounded-lg border border-hair">
          <table className="w-full text-left text-sm">
            <thead className="bg-card text-ink-3">
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  {hg.headers.map((h) => (
                    <th
                      key={h.id}
                      className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide"
                    >
                      {flexRender(h.column.columnDef.header, h.getContext())}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-hair hover:bg-card/50">
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-4 py-3">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td className="px-4 py-10 text-center text-sm text-ink-3" colSpan={8}>
                    {loadError ? "Codes could not be loaded." : "No promo codes yet."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
