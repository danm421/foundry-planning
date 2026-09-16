// src/components/forms/holdings-tab.tsx
"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AssetClassOption } from "./asset-mix-tab";
import { HoldingOverrideEditor } from "./holding-override-editor";
import { fieldLabelBaseClassName, inputBaseClassName, inputCompactClassName } from "./input-styles";
import {
  listHoldings, createHolding, updateHolding, deleteHolding,
  setHoldingOverride, classifyTicker, setAccountDeriveFromHoldings, getQuote,
  type HoldingRow, type QuoteResult,
} from "@/lib/investments/holdings-client";
import { summarizeHoldings, rowChip } from "@/lib/investments/holdings-display";
import { holdingMarketValue } from "@/lib/investments/holdings-rollup";

interface Props {
  clientId: string;
  /** Saved account id, or null when the account hasn't been created yet. */
  accountId: string | null;
  /** True while a scenario overlay is active — holdings edit is base-mode only. */
  scenarioActive: boolean;
  assetClasses: AssetClassOption[];
  /** Whether this account derives its mix + value from holdings. */
  deriveFromHoldings: boolean;
  /** Persist + reflect a change to deriveFromHoldings. */
  onDeriveFromHoldingsChange: (next: boolean) => void;
  /** Report derived totals up so the Details tab can show read-only value/basis. */
  onTotalsChange: (totals: { value: number; basis: number } | null) => void;
  /** Fired after any holdings mutation (add/edit/delete/override). The server
   *  re-derives the account's asset mix on each of these, so the parent uses
   *  this to re-read allocations and keep the Asset Mix tab in sync without a
   *  save + reopen. */
  onHoldingsChanged?: () => void;
}

const money = (n: number) =>
  `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

// Display formatters for the editable numeric cells: grouped/currency when the
// cell is at rest, raw value while it's being edited (see CellInput).
const fmtShares = (raw: string) => {
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 4 }) : raw;
};
const fmtPrice = (raw: string) => {
  const n = parseFloat(raw);
  return Number.isFinite(n)
    ? `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`
    : raw;
};
const fmtMoney = (raw: string) => {
  const n = parseFloat(raw);
  return Number.isFinite(n) ? money(n) : raw;
};

// Opaque fill lives on the cells, not the row: a sticky `<thead>` doesn't paint
// its own background, so rows would scroll through it.
const TH = "sticky top-0 z-10 border-b border-hair bg-card-2 px-2 py-2 font-medium";

export function HoldingsTab({
  clientId, accountId, scenarioActive, assetClasses,
  deriveFromHoldings, onDeriveFromHoldingsChange, onTotalsChange, onHoldingsChanged,
}: Props) {
  const [rows, setRows] = useState<HoldingRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingOverride, setEditingOverride] = useState<string | null>(null);

  // Add-row inputs.
  const [ticker, setTicker] = useState("");
  const [shares, setShares] = useState("");
  const [price, setPrice] = useState("");
  const [basis, setBasis] = useState("");
  const [adding, setAdding] = useState(false);
  const [fetchingPrice, setFetchingPrice] = useState(false);
  /** What the last price lookup did, as one value — an "unpriced" outcome is
   *  shown so a blank Price box reads as "we couldn't price this" rather than
   *  "the app ignored me". Splitting it across two slots let a stale as-of line
   *  survive a ticker change. */
  const [quoteOutcome, setQuoteOutcome] = useState<
    { kind: "priced"; asOf: string } | { kind: "unpriced"; ticker: string } | null
  >(null);
  // Guards against out-of-order responses: only the latest ticker's result wins.
  const quoteSeq = useRef(0);
  // A click on "+ Add" blurs the ticker field first, so the blur lookup and the
  // add would otherwise each buy the same (paid) quote. Callers share one.
  const inFlightQuote = useRef<{ ticker: string; promise: Promise<QuoteResult | null> } | null>(null);
  // Last ticker we successfully priced — skip refetching it so a manually-edited
  // price isn't clobbered on a re-blur (and we don't burn a paid quote call).
  const lastQuotedTicker = useRef("");

  const canEdit = accountId != null && !scenarioActive;

  const summary = useMemo(() => summarizeHoldings(rows, assetClasses), [rows, assetClasses]);

  // Load on mount / account change.
  useEffect(() => {
    if (!canEdit || !accountId) return;
    let cancelled = false;
    (async () => {
      try {
        const list = await listHoldings(clientId, accountId);
        if (!cancelled) { setRows(list); setLoaded(true); }
      } catch {
        if (!cancelled) { setError("Couldn't load holdings."); setLoaded(true); }
      }
    })();
    return () => { cancelled = true; };
  }, [clientId, accountId, canEdit]);

  // Push derived totals up whenever rows change (holdings mode shows them as the
  // authoritative value/basis on the Details tab).
  useEffect(() => {
    onTotalsChange(rows.length > 0 ? { value: summary.value, basis: summary.basis } : null);
  }, [rows, summary, onTotalsChange]);

  const setDerive = useCallback(async (next: boolean) => {
    if (!accountId) return;
    await setAccountDeriveFromHoldings(clientId, accountId, next);
    onDeriveFromHoldingsChange(next);
  }, [clientId, accountId, onDeriveFromHoldingsChange]);

  /** Price a ticker and reflect the outcome in the add row. Returns the quote so
   *  a caller mid-add can use it without waiting for a state flush. */
  const fetchQuoteFor = useCallback((t: string): Promise<QuoteResult | null> => {
    if (!accountId || t === "") return Promise.resolve(null);
    if (inFlightQuote.current?.ticker === t) return inFlightQuote.current.promise;
    const seq = ++quoteSeq.current;
    setFetchingPrice(true);
    const promise = (async () => {
      try {
        const quote = await getQuote(clientId, accountId, t);
        // The caller still gets the answer for the ticker it asked about; only
        // the add row skips it, because the user has moved on to another one.
        if (seq !== quoteSeq.current) return quote;
        if (quote) {
          setPrice(String(quote.price));
          setQuoteOutcome({ kind: "priced", asOf: quote.asOf });
          lastQuotedTicker.current = t;
        } else {
          setQuoteOutcome({ kind: "unpriced", ticker: t });
        }
        return quote;
      } finally {
        if (seq === quoteSeq.current) setFetchingPrice(false);
        if (inFlightQuote.current?.ticker === t) inFlightQuote.current = null;
      }
    })();
    inFlightQuote.current = { ticker: t, promise };
    return promise;
  }, [clientId, accountId]);

  async function handleAdd() {
    if (!accountId || ticker.trim() === "" || adding) return;
    setAdding(true);
    setError(null);
    try {
      const t = ticker.trim().toUpperCase();
      // Enter-to-add can fire before the ticker field ever blurs, so an unpriced
      // row would save at $0. Resolve the price here too rather than on blur
      // only — independent of the classify call, so both go out together.
      const [quote, classified] = await Promise.all([
        price === "" ? fetchQuoteFor(t) : Promise.resolve(null),
        classifyTicker(clientId, accountId, t), // fail-soft
      ]);
      const resolvedPrice = quote ? String(quote.price) : price;
      const resolvedAsOf = quote
        ? quote.asOf
        : quoteOutcome?.kind === "priced" ? quoteOutcome.asOf : null;
      await createHolding(clientId, accountId, {
        securityId: classified.security?.id ?? null,
        displayTicker: t,
        // Falls back to the search-resolved name when the ticker couldn't be
        // classified — a named row beats a bare ticker even unclassified.
        displayName: classified.security?.name ?? classified.displayName ?? null,
        shares: shares === "" ? 0 : parseFloat(shares),
        price: resolvedPrice === "" ? 0 : parseFloat(resolvedPrice),
        priceAsOf: resolvedAsOf ?? undefined,
        costBasis: basis === "" ? 0 : parseFloat(basis),
      });
      // The POST response is a raw row; re-list to get the enriched shape
      // (securityWeights/overrides/needsReview) so the chip + preview are correct.
      const list = await listHoldings(clientId, accountId);
      setRows(list);
      // First holding on an opted-in account: the server sync already seeded the
      // mix + set growthSource; just make sure the form reflects derive=true.
      if (list.length === 1 && deriveFromHoldings) onDeriveFromHoldingsChange(true);
      setTicker(""); setShares(""); setPrice(""); setBasis("");
      setQuoteOutcome(null);
      lastQuotedTicker.current = "";
      onHoldingsChanged?.();
    } catch {
      setError("Couldn't add the holding. Check the values and try again.");
    } finally {
      setAdding(false);
    }
  }

  async function handleTickerBlur() {
    const t = ticker.trim().toUpperCase();
    if (!canEdit || t === "" || t === lastQuotedTicker.current) return;
    await fetchQuoteFor(t);
  }

  async function handleFieldBlur(
    holdingId: string,
    patch: { shares?: number; price?: number; costBasis?: number; displayName?: string; marketValue?: number | null },
  ) {
    if (!accountId) return;
    try {
      await updateHolding(clientId, accountId, holdingId, patch);
      setRows((prev) => prev.map((r) =>
        r.id === holdingId
          ? {
              ...r,
              shares: patch.shares != null ? String(patch.shares) : r.shares,
              price: patch.price != null ? String(patch.price) : r.price,
              costBasis: patch.costBasis != null ? String(patch.costBasis) : r.costBasis,
              displayName: patch.displayName ?? r.displayName,
              // null is intentional here: clears a stored override so value falls back to shares×price.
              marketValue: "marketValue" in patch ? (patch.marketValue != null ? String(patch.marketValue) : null) : r.marketValue,
            }
          : r,
      ));
      onHoldingsChanged?.();
    } catch {
      setError("Couldn't save that change.");
    }
  }

  async function handleDelete(holdingId: string) {
    if (!accountId) return;
    try {
      await deleteHolding(clientId, accountId, holdingId);
      setRows((prev) => prev.filter((r) => r.id !== holdingId));
      onHoldingsChanged?.();
    } catch {
      setError("Couldn't delete the holding.");
    }
  }

  async function handleOverrideSave(
    holdingId: string, overrides: { assetClassId: string; weight: number }[],
  ) {
    if (!accountId) return;
    await setHoldingOverride(clientId, accountId, holdingId, overrides);
    const list = await listHoldings(clientId, accountId);
    setRows(list);
    onHoldingsChanged?.();
  }

  // ── Gate states ──────────────────────────────────────────────────────────
  if (accountId == null) {
    return (
      <p className="rounded-md border border-hair bg-card-2 px-3 py-4 text-sm text-ink-3">
        Save the account first to add holdings.
      </p>
    );
  }
  if (scenarioActive) {
    return (
      <p className="rounded-md border border-hair bg-card-2 px-3 py-4 text-sm text-ink-3">
        Holdings are edited on the base plan. Switch out of this scenario to add or change holdings.
      </p>
    );
  }

  const driving = deriveFromHoldings && rows.length > 0;

  return (
    <div className="space-y-4">
      {/* Holdings-driving banner + toggle */}
      {rows.length > 0 && (
        driving ? (
          <div className="flex items-center justify-between rounded-md border border-accent/40 bg-accent-wash px-3 py-2 text-sm text-accent-ink">
            <span>This account&apos;s value &amp; asset mix are derived from the holdings below.</span>
            <button type="button" onClick={() => setDerive(false)} className="ml-3 shrink-0 underline">
              Use a different source
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between rounded-md border border-hair bg-card-2 px-3 py-2 text-sm text-ink-2">
            <span>Holdings are entered but not driving this account.</span>
            <button type="button" onClick={() => setDerive(true)} className="ml-3 shrink-0 underline">
              Drive this account from holdings
            </button>
          </div>
        )
      )}

      {error && (
        <p className="rounded-md border border-crit/40 bg-crit/10 px-3 py-2 text-sm text-crit">{error}</p>
      )}

      {/* Add-holding row */}
      <div className="rounded-md border border-hair bg-card-2 p-3">
        <div className="flex flex-wrap items-end gap-3">
          <AddField label="Ticker" value={ticker} width="w-32"
            onChange={(v) => { setTicker(v); setQuoteOutcome(null); }}
            onEnter={handleAdd} onBlur={handleTickerBlur} />
          <AddField label="Shares" value={shares} onChange={setShares} width="w-28" onEnter={handleAdd} numeric />
          <AddField label="Price" value={price} onChange={setPrice} width="w-28"
            onEnter={handleAdd} numeric placeholder={fetchingPrice ? "fetching…" : undefined} />
          <AddField label="Cost basis" value={basis} onChange={setBasis} width="w-32" onEnter={handleAdd} numeric />
          <button
            type="button"
            onClick={handleAdd}
            disabled={adding || ticker.trim() === ""}
            className="h-9 rounded-[var(--radius-sm)] bg-accent px-4 text-sm font-medium text-accent-on hover:opacity-90 disabled:opacity-50"
          >
            {adding ? "Adding…" : "+ Add"}
          </button>
        </div>
        {/* Says out loud what the price lookup did — a silently blank Price box
            was being read as a broken field rather than an unpriced security. */}
        {quoteOutcome?.kind === "unpriced" ? (
          <p className="mt-2 text-xs text-warn">
            No market price found for {quoteOutcome.ticker} — type one in, or leave it blank and
            set the market value on the row.
          </p>
        ) : quoteOutcome?.kind === "priced" ? (
          <p className="mt-2 text-xs text-ink-3">
            Price is the market close for {quoteOutcome.asOf}. Type over it to use your own.
          </p>
        ) : null}
      </div>

      {/* Holdings table */}
      {loaded && rows.length === 0 ? (
        <p className="text-sm text-ink-3">No holdings yet. Add a ticker above.</p>
      ) : (
        <div className="max-h-[min(46vh,340px)] overflow-auto rounded-md border border-hair">
          <table className="w-full text-sm">
            {/* Header pins to the top of this region so the column a value belongs
                to stays on screen while the list scrolls. */}
            <thead className="text-xs uppercase text-ink-3">
              <tr>
                <th className={`${TH} text-left`}>Ticker</th>
                <th className={`${TH} text-left`}>Name</th>
                <th className={`${TH} text-right`}>Shares</th>
                <th className={`${TH} text-right`}>Price</th>
                <th className={`${TH} text-right`}>Market value</th>
                <th className={`${TH} text-right`}>Cost basis</th>
                <th className={`${TH} text-left`}>Asset class</th>
                <th className={TH} />
              </tr>
            </thead>
            <tbody className="divide-y divide-hair">
              {rows.map((r) => {
                const chip = rowChip(r, assetClasses);
                const mv = holdingMarketValue({
                  marketValue: r.marketValue != null ? parseFloat(r.marketValue) : null,
                  shares: parseFloat(r.shares),
                  price: parseFloat(r.price),
                });
                return (
                  <Fragment key={r.id}>
                    <tr className="text-ink-2">
                      <td className="whitespace-nowrap px-2 py-2 font-medium text-ink">{r.displayTicker ?? "—"}</td>
                      <td className="min-w-[12rem] px-2 py-2">
                        <CellInput defaultValue={r.displayName ?? ""} align="left"
                          onCommit={(v) => handleFieldBlur(r.id, { displayName: v })} text />
                      </td>
                      <td className="min-w-[6.5rem] px-2 py-2 text-right">
                        <CellInput defaultValue={r.shares} format={fmtShares}
                          onCommit={(v) => handleFieldBlur(r.id, { shares: v === "" ? 0 : parseFloat(v) })} />
                      </td>
                      <td className="min-w-[5.5rem] px-2 py-2 text-right">
                        <CellInput defaultValue={r.price} format={fmtPrice}
                          onCommit={(v) => handleFieldBlur(r.id, { price: v === "" ? 0 : parseFloat(v) })} />
                      </td>
                      <td className="min-w-[7rem] px-2 py-2 text-right">
                        <CellInput defaultValue={r.marketValue ?? (Number.isFinite(mv) ? String(mv) : "0")} format={fmtMoney}
                          onCommit={(v) => handleFieldBlur(r.id, { marketValue: v === "" ? null : parseFloat(v) })} />
                      </td>
                      <td className="min-w-[7rem] px-2 py-2 text-right">
                        <CellInput defaultValue={r.costBasis} format={fmtMoney}
                          onCommit={(v) => handleFieldBlur(r.id, { costBasis: v === "" ? 0 : parseFloat(v) })} />
                      </td>
                      <td className="whitespace-nowrap px-2 py-2">
                        {chip.kind === "locked" ? (
                          <span
                            className={chipClass(chip.kind)}
                            title="Cash is a system class and cannot be reassigned"
                          >
                            {chip.label}
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setEditingOverride(editingOverride === r.id ? null : r.id)}
                            className={chipClass(chip.kind)}
                            title="Edit asset-class blend"
                          >
                            {chip.label}
                          </button>
                        )}
                      </td>
                      <td className="px-2 py-2 text-right">
                        <button type="button" onClick={() => handleDelete(r.id)}
                          className="text-ink-4 hover:text-crit" aria-label="Delete holding">✕</button>
                      </td>
                    </tr>
                    {editingOverride === r.id && (
                      <tr>
                        <td colSpan={8} className="px-3 pb-3">
                          <HoldingOverrideEditor
                            holding={r}
                            assetClasses={assetClasses}
                            onSave={(ov) => handleOverrideSave(r.id, ov)}
                            onClose={() => setEditingOverride(null)}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Derived totals strip */}
      {rows.length > 0 && (
        <div className="space-y-1 rounded-md border border-hair-2 bg-card-2 px-3 py-2">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium text-ink-2">Account value (derived)</span>
            <span className="tabular font-semibold text-ink">{money(summary.value)}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-ink-3">Cost basis (derived)</span>
            <span className="tabular text-ink-2">{money(summary.basis)}</span>
          </div>
          <div className="border-t border-hair pt-1 text-xs text-ink-3">
            Blend:{" "}
            {summary.blend.length === 0
              ? "unclassified"
              : summary.blend.map((b) => `${b.name} ${(b.weight * 100).toFixed(0)}%`).join(" · ")}
            {summary.residual > 0.0001 && ` · Unclassified ${(summary.residual * 100).toFixed(0)}% (→ inflation)`}
          </div>
        </div>
      )}
    </div>
  );
}


function chipClass(kind: "derived" | "manual" | "needs_review" | "locked") {
  const base = "rounded-full px-2 py-0.5 text-xs";
  if (kind === "locked") return `${base} bg-card-2 text-ink-4 cursor-default`;
  const interactive = `${base} hover:opacity-80`;
  if (kind === "manual") return `${interactive} bg-accent-wash text-accent-ink`;
  if (kind === "needs_review") return `${interactive} bg-warn/15 text-warn`;
  return `${interactive} bg-card-hover text-ink-2`;
}

function AddField({
  label, value, onChange, width, onEnter, onBlur, placeholder, numeric = false,
}: {
  label: string; value: string; onChange: (v: string) => void;
  width: string; onEnter: () => void; onBlur?: () => void; placeholder?: string;
  numeric?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className={fieldLabelBaseClassName}>{label}</span>
      <input
        type="text"
        inputMode={numeric ? "decimal" : "text"}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => onBlur?.()}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onEnter(); } }}
        className={`${inputBaseClassName} ${width} ${numeric ? "tabular text-right" : ""}`}
      />
    </label>
  );
}

function CellInput({
  defaultValue, onCommit, align = "right", text = false, format,
}: {
  defaultValue: string; onCommit: (v: string) => void; align?: "left" | "right"; text?: boolean;
  /** Render this grouped/currency string when the cell is at rest, raw value while focused. */
  format?: (v: string) => string;
}) {
  const [v, setV] = useState(defaultValue);
  const [focused, setFocused] = useState(false);

  // Re-sync when the parent commits a normalized value (e.g. "8.3100" → "8.31").
  useEffect(() => { setV(defaultValue); }, [defaultValue]);

  const display = focused || !format ? v : format(v);

  return (
    <input
      type="text"
      inputMode={text ? "text" : "decimal"}
      value={display}
      onFocus={() => setFocused(true)}
      onChange={(e) => setV(text ? e.target.value : e.target.value.replace(/[^\d.]/g, ""))}
      onBlur={() => { setFocused(false); if (v !== defaultValue) onCommit(v); }}
      // The border is always drawn: with a transparent-until-hover box these read
      // as printed text, and a saved row looked like it could no longer be edited.
      className={`${inputCompactClassName} ${align === "right" ? "text-right" : "text-left"} ${
        text ? "" : "tabular"
      }`}
    />
  );
}
