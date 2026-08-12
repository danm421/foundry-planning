"use client";

import { useRef, useState } from "react";
import MoneyText from "@/components/money-text";
import { holdingMarketValue } from "@/lib/extraction/normalize-holdings";
import { FieldTooltip } from "@/components/forms/field-tooltip";
import { TrashIcon } from "@/components/icons";
import type { AdHocHoldingInput } from "@/lib/investments/rebalance/types";

// ── Types ─────────────────────────────────────────────────────────────────────

export type RebalanceSourceValue =
  | { kind: "accounts"; accountIds: string[] }
  | { kind: "outside"; taxable: boolean; holdings: AdHocHoldingInput[] };

export interface RebalanceSourceProps {
  clientId: string;
  accounts: { id: string; name: string; category: string; value: number }[];
  value: RebalanceSourceValue;
  onChange: (v: RebalanceSourceValue) => void;
  /** Source-side tickers the last compute couldn't classify. */
  unresolvedTickers?: string[];
}

/** One editable position. Every numeric field is a string so a half-typed
 *  value ("1.") survives a re-render; conversion happens on emit. */
interface OutsideRow {
  _key: number;
  ticker: string;
  /** Description carried over from an upload (bonds, cash). Display-only. */
  name: string;
  shares: string;
  price: string;
  marketValue: string;
  costBasis: string;
}

/** An account read off an uploaded statement, before the advisor picks one. */
interface ExtractedPortfolio {
  name: string;
  taxable: boolean;
  holdings: AdHocHoldingInput[];
}

// ── Row helpers ───────────────────────────────────────────────────────────────

const blankRow = (key: number): OutsideRow => ({
  _key: key,
  ticker: "",
  name: "",
  shares: "",
  price: "",
  marketValue: "",
  costBasis: "",
});

/** A position off the wire as the editor holds it: every numeric field a string. */
const toRow = (h: AdHocHoldingInput, key: number): OutsideRow => ({
  _key: key,
  ticker: h.ticker ?? "",
  name: h.name ?? "",
  shares: h.shares != null ? String(h.shares) : "",
  price: h.price != null ? String(h.price) : "",
  marketValue: h.marketValue != null ? String(h.marketValue) : "",
  costBasis: h.costBasis != null ? String(h.costBasis) : "",
});

/**
 * Seed the editor from the value it was mounted with — the same job
 * `rebalance-target.tsx`'s `seedRows` does for the other side.
 *
 * A reopened proposal arrives with its stored positions already in `value`. Left
 * to a blank literal, the editor renders one empty row at a $0 total — over a
 * proposal holding real positions — and the first keystroke makes `emitOutside`
 * hand the parent that one row, so a Compute or a fee-triggered Save then writes
 * the truncated portfolio over the stored one.
 */
function seedOutsideRows(value: RebalanceSourceValue): OutsideRow[] {
  if (value.kind === "outside" && value.holdings.length > 0) return value.holdings.map(toRow);
  return [blankRow(0)];
}

const num = (s: string): number | undefined => {
  const n = Number(s.trim());
  return s.trim() === "" || !Number.isFinite(n) ? undefined : n;
};

const NUMERIC_FIELDS = ["shares", "price", "marketValue", "costBasis"] as const;

/** Blank fields are omitted, not sent as 0 — "no basis stated" and "$0 basis"
 *  mean different things to the tax estimate. */
function toHolding(r: OutsideRow): AdHocHoldingInput {
  const out: AdHocHoldingInput = {};
  if (r.ticker.trim()) out.ticker = r.ticker.trim().toUpperCase();
  if (r.name.trim()) out.name = r.name.trim();
  for (const field of NUMERIC_FIELDS) {
    const v = num(r[field]);
    if (v != null) out[field] = v;
  }
  return out;
}

const isNamed = (r: OutsideRow) => Boolean(r.ticker.trim() || r.name.trim());

/** What the row is worth. Runs the row through the same completion the compute
 *  route applies, so the total shown here can't drift from the total priced. */
const rowValue = (r: OutsideRow): number => holdingMarketValue(toHolding(r));

// ── RebalanceSource ───────────────────────────────────────────────────────────

export function RebalanceSource({
  clientId,
  accounts,
  value,
  onChange,
  unresolvedTickers = [],
}: RebalanceSourceProps) {
  const mode = value.kind;

  // ── Client-accounts state lives in the parent; outside-portfolio state here ──
  const [rows, setRows] = useState<OutsideRow[]>(() => seedOutsideRows(value));
  // The seed took _keys 0..n-1, so the next added row starts after them.
  const nextKey = useRef(rows.length);
  const [taxable, setTaxable] = useState(() => (value.kind === "outside" ? value.taxable : true));

  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [choices, setChoices] = useState<ExtractedPortfolio[]>([]);

  // ── Emit ──────────────────────────────────────────────────────────────────

  function emitOutside(nextRows: OutsideRow[], nextTaxable: boolean) {
    setRows(nextRows);
    setTaxable(nextTaxable);
    onChange({
      kind: "outside",
      taxable: nextTaxable,
      holdings: nextRows.filter(isNamed).map(toHolding),
    });
  }

  function setMode(next: "accounts" | "outside") {
    if (next === "accounts") onChange({ kind: "accounts", accountIds: [] });
    else emitOutside(rows, taxable);
  }

  const updateRow = (key: number, patch: Partial<OutsideRow>) =>
    emitOutside(
      rows.map((r) => (r._key === key ? { ...r, ...patch } : r)),
      taxable,
    );

  // ── Upload ────────────────────────────────────────────────────────────────

  function loadPortfolio(p: ExtractedPortfolio) {
    const loaded = p.holdings.map((h) => toRow(h, nextKey.current++));
    setChoices([]);
    emitOutside(loaded.length > 0 ? loaded : [blankRow(nextKey.current++)], p.taxable);
  }

  async function handleUpload(file: File) {
    setUploading(true);
    setUploadError(null);
    setWarnings([]);
    setChoices([]);
    try {
      const form = new FormData();
      form.set("file", file);
      const res = await fetch(`/api/clients/${clientId}/rebalance/extract-holdings`, {
        method: "POST",
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not read that statement");

      const found = (data.accounts ?? []) as ExtractedPortfolio[];
      setWarnings(data.warnings ?? []);
      // One account loads straight in; several need the advisor to say which,
      // because their tax character — and so the tax estimate — differs.
      if (found.length === 1) loadPortfolio(found[0]);
      else if (found.length > 1) setChoices(found);
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Could not read that statement");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  // ── Derived ───────────────────────────────────────────────────────────────

  const selectedAccountIds = value.kind === "accounts" ? value.accountIds : [];
  const selected = new Set(selectedAccountIds);
  const accountsTotal = accounts
    .filter((a) => selected.has(a.id))
    .reduce((s, a) => s + a.value, 0);

  const named = rows.filter(isNamed);
  const outsideTotal = named.reduce((s, r) => s + rowValue(r), 0);
  const missingBasis = named.filter((r) => num(r.costBasis) == null).length;
  const isUnresolved = (t: string) =>
    Boolean(t.trim()) && unresolvedTickers.includes(t.trim().toUpperCase());

  const toggleAccount = (id: string) =>
    onChange({
      kind: "accounts",
      accountIds: selected.has(id)
        ? selectedAccountIds.filter((x) => x !== id)
        : [...selectedAccountIds, id],
    });

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-ink">Current portfolio</p>

        <div className="inline-flex rounded-md border border-hair-2 p-0.5">
          <button
            type="button"
            onClick={() => setMode("accounts")}
            className={
              mode === "accounts"
                ? "rounded bg-card-2 px-3 py-1 text-sm text-ink"
                : "px-3 py-1 text-sm text-ink-3"
            }
          >
            Client accounts
          </button>
          <button
            type="button"
            onClick={() => setMode("outside")}
            className={
              mode === "outside"
                ? "rounded bg-card-2 px-3 py-1 text-sm text-ink"
                : "px-3 py-1 text-sm text-ink-3"
            }
          >
            Outside portfolio
          </button>
        </div>
      </div>

      {/* ── Client accounts ── */}
      {mode === "accounts" && (
        <>
          {accounts.length === 0 && (
            <p className="text-sm text-ink-3">No accounts have holdings yet.</p>
          )}
          <ul className="divide-y divide-hair-2">
            {accounts.map((a) => (
              <li key={a.id} className="flex items-center justify-between py-2">
                <label className="flex cursor-pointer items-center gap-2 text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={selected.has(a.id)}
                    onChange={() => toggleAccount(a.id)}
                    className="peer h-4 w-4 cursor-pointer appearance-none rounded border border-hair-2 bg-card-2 transition-colors hover:border-accent/60 checked:border-accent checked:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                  />
                  {a.name}
                  <span className="font-mono text-[11px] uppercase tracking-wide text-ink-4">
                    {a.category}
                  </span>
                </label>
                <MoneyText value={a.value} />
              </li>
            ))}
          </ul>
          <div className="flex justify-between border-t border-hair-2 pt-2 text-sm">
            <span className="text-ink-3">Selected total</span>
            <MoneyText value={accountsTotal} />
          </div>
        </>
      )}

      {/* ── Outside portfolio ── */}
      {mode === "outside" && (
        <div className="space-y-3">
          <p className="text-sm text-ink-3">
            A portfolio that isn&rsquo;t among this client&rsquo;s assets. Nothing here is saved.
          </p>

          {/* Tax character + statement upload */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1.5 text-sm text-ink-2">
                Tax treatment
                <FieldTooltip text="Only a taxable portfolio realizes gains when it is sold. The rate comes from this client's own bracket in the plan's first year." />
              </span>
              <div className="inline-flex rounded-md border border-hair-2 p-0.5">
                <button
                  type="button"
                  onClick={() => emitOutside(rows, true)}
                  className={
                    taxable
                      ? "rounded bg-card-2 px-3 py-1 text-sm text-ink"
                      : "px-3 py-1 text-sm text-ink-3"
                  }
                >
                  Taxable
                </button>
                <button
                  type="button"
                  onClick={() => emitOutside(rows, false)}
                  className={
                    !taxable
                      ? "rounded bg-card-2 px-3 py-1 text-sm text-ink"
                      : "px-3 py-1 text-sm text-ink-3"
                  }
                >
                  Tax-deferred
                </button>
              </div>
            </div>

            <input
              ref={fileInput}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.csv,.xlsx,.docx"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleUpload(f);
              }}
            />
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              disabled={uploading}
              className="rounded border border-dashed border-hair-2 px-3 py-1.5 text-sm text-ink-2 hover:border-hair hover:text-ink disabled:opacity-50"
            >
              {uploading ? "Reading statement…" : "Upload statement"}
            </button>
          </div>

          {uploadError && <p className="text-sm text-crit">{uploadError}</p>}
          {warnings.map((w) => (
            <p key={w} className="text-xs text-warn">
              {w}
            </p>
          ))}

          {/* Which account off the statement? */}
          {choices.length > 0 && (
            <div className="space-y-2 rounded-lg border border-hair p-3">
              <p className="text-sm text-ink">
                That statement holds {choices.length} accounts. Pick the one to model.
              </p>
              <ul className="divide-y divide-hair-2">
                {choices.map((c, i) => (
                  <li key={`${c.name}-${i}`} className="flex items-center justify-between gap-3 py-2">
                    <span className="text-sm text-ink">
                      {c.name}
                      <span className="ml-2 text-xs text-ink-3">
                        {c.holdings.length} holdings · {c.taxable ? "taxable" : "tax-deferred"}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => loadPortfolio(c)}
                      className="rounded border border-hair px-2 py-1 text-xs text-ink-2 hover:border-accent hover:text-ink"
                    >
                      Use these
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Holdings table */}
          <div className="overflow-x-auto rounded-lg border border-hair">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-hair bg-card-2/60 text-left text-xs font-medium uppercase tracking-wider text-ink-3">
                  <th className="px-3 py-2">Ticker</th>
                  <th className="px-3 py-2 text-right">Shares</th>
                  <th className="px-3 py-2 text-right">Price</th>
                  <th className="px-3 py-2 text-right">Value</th>
                  <th className="px-3 py-2 text-right">Cost basis</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hair">
                {rows.map((r) => (
                  <tr key={r._key}>
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        value={r.ticker}
                        onChange={(e) => updateRow(r._key, { ticker: e.target.value })}
                        placeholder="e.g. SPY"
                        aria-label="Ticker symbol"
                        className={`w-28 rounded border bg-transparent px-2 py-1 text-sm text-ink focus:outline-none ${
                          isUnresolved(r.ticker)
                            ? "border-crit focus:border-crit"
                            : "border-hair focus:border-accent"
                        }`}
                      />
                      {r.name && <p className="mt-1 text-[11px] text-ink-4">{r.name}</p>}
                      {isUnresolved(r.ticker) && (
                        <p className="mt-1 text-[11px] text-crit">
                          Couldn&rsquo;t classify {r.ticker.trim().toUpperCase()}
                        </p>
                      )}
                    </td>
                    <NumberCell
                      label="Shares"
                      value={r.shares}
                      onChange={(v) => updateRow(r._key, { shares: v })}
                    />
                    <NumberCell
                      label="Price"
                      value={r.price}
                      onChange={(v) => updateRow(r._key, { price: v })}
                    />
                    <NumberCell
                      label="Market value"
                      value={r.marketValue}
                      placeholder={
                        num(r.shares) != null && num(r.price) != null
                          ? rowValue(r).toFixed(2)
                          : undefined
                      }
                      onChange={(v) => updateRow(r._key, { marketValue: v })}
                    />
                    <NumberCell
                      label="Cost basis"
                      value={r.costBasis}
                      onChange={(v) => updateRow(r._key, { costBasis: v })}
                    />
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() =>
                          emitOutside(
                            rows.filter((x) => x._key !== r._key),
                            taxable,
                          )
                        }
                        className="rounded p-1 text-ink-3 hover:bg-card-2 hover:text-ink"
                        title="Remove holding"
                        aria-label="Remove holding"
                      >
                        <TrashIcon className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => emitOutside([...rows, blankRow(nextKey.current++)], taxable)}
              className="rounded border border-dashed border-hair-2 px-3 py-1.5 text-sm text-ink-2 hover:border-hair hover:text-ink"
            >
              + Add holding
            </button>
            <span className="flex items-center gap-2 text-sm text-ink-3">
              Total <MoneyText value={outsideTotal} />
            </span>
          </div>

          {taxable && missingBasis > 0 && (
            <p className="text-xs text-warn">
              No cost basis on {missingBasis} of {named.length} holdings — those are treated as
              having no gain, so the tax estimate is a floor.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

// ── NumberCell ────────────────────────────────────────────────────────────────

function NumberCell({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
}) {
  return (
    <td className="px-3 py-2">
      <div className="flex justify-end">
        <input
          type="number"
          step="any"
          min="0"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          aria-label={label}
          className="w-28 rounded border border-hair bg-transparent px-2 py-1 text-right text-sm tabular-nums text-ink focus:border-accent focus:outline-none"
        />
      </div>
    </td>
  );
}
