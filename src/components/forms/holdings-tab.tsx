// src/components/forms/holdings-tab.tsx
"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AssetClassOption } from "./asset-mix-tab";
import { HoldingOverrideEditor } from "./holding-override-editor";
import {
  listHoldings, createHolding, updateHolding, deleteHolding,
  setHoldingOverride, classifyTicker, setAccountDeriveFromHoldings, getQuote,
  type HoldingRow,
} from "@/lib/investments/holdings-client";
import { summarizeHoldings, rowChip } from "@/lib/investments/holdings-display";

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

export function HoldingsTab({
  clientId, accountId, scenarioActive, assetClasses,
  deriveFromHoldings, onDeriveFromHoldingsChange, onTotalsChange,
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
  const [priceAsOf, setPriceAsOf] = useState<string | null>(null);
  const [fetchingPrice, setFetchingPrice] = useState(false);
  // Guards against out-of-order responses: only the latest ticker's result wins.
  const quoteSeq = useRef(0);
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

  async function handleAdd() {
    if (!accountId || ticker.trim() === "") return;
    setAdding(true);
    setError(null);
    try {
      const t = ticker.trim().toUpperCase();
      const classified = await classifyTicker(clientId, accountId, t); // fail-soft
      await createHolding(clientId, accountId, {
        securityId: classified.security?.id ?? null,
        displayTicker: t,
        displayName: classified.security?.name ?? null,
        shares: shares === "" ? 0 : parseFloat(shares),
        price: price === "" ? 0 : parseFloat(price),
        priceAsOf: priceAsOf ?? undefined,
        costBasis: basis === "" ? 0 : parseFloat(basis),
      });
      // The POST response is a raw row; re-list to get the enriched shape
      // (securityWeights/overrides/needsReview) so the chip + preview are correct.
      const list = await listHoldings(clientId, accountId);
      setRows(list);
      // First holding on an opted-in account: the server sync already seeded the
      // mix + set growthSource; just make sure the form reflects derive=true.
      if (list.length === 1 && deriveFromHoldings) onDeriveFromHoldingsChange(true);
      setTicker(""); setShares(""); setPrice(""); setBasis(""); setPriceAsOf(null);
      lastQuotedTicker.current = "";
    } catch {
      setError("Couldn't add the holding. Check the values and try again.");
    } finally {
      setAdding(false);
    }
  }

  async function handleTickerBlur() {
    const t = ticker.trim().toUpperCase();
    if (!canEdit || !accountId || t === "" || t === lastQuotedTicker.current) return;
    const seq = ++quoteSeq.current;
    setFetchingPrice(true);
    try {
      const quote = await getQuote(clientId, accountId, t);
      // Ignore a stale response if the ticker changed (or blurred again) since.
      if (seq !== quoteSeq.current) return;
      if (quote) { setPrice(String(quote.price)); setPriceAsOf(quote.asOf); lastQuotedTicker.current = t; }
    } finally {
      if (seq === quoteSeq.current) setFetchingPrice(false);
    }
  }

  async function handleFieldBlur(
    holdingId: string, patch: { shares?: number; price?: number; costBasis?: number; displayName?: string },
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
            }
          : r,
      ));
    } catch {
      setError("Couldn't save that change.");
    }
  }

  async function handleDelete(holdingId: string) {
    if (!accountId) return;
    try {
      await deleteHolding(clientId, accountId, holdingId);
      setRows((prev) => prev.filter((r) => r.id !== holdingId));
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
  }

  // ── Gate states ──────────────────────────────────────────────────────────
  if (accountId == null) {
    return (
      <p className="rounded-md border border-gray-700 bg-gray-800/60 px-3 py-4 text-sm text-gray-400">
        Save the account first to add holdings.
      </p>
    );
  }
  if (scenarioActive) {
    return (
      <p className="rounded-md border border-gray-700 bg-gray-800/60 px-3 py-4 text-sm text-gray-400">
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
          <div className="flex items-center justify-between rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-sm text-accent-ink">
            <span>This account&apos;s value &amp; asset mix are derived from the holdings below.</span>
            <button type="button" onClick={() => setDerive(false)} className="ml-3 shrink-0 underline">
              Use a different source
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between rounded-md border border-gray-700 bg-gray-800/60 px-3 py-2 text-sm text-gray-300">
            <span>Holdings are entered but not driving this account.</span>
            <button type="button" onClick={() => setDerive(true)} className="ml-3 shrink-0 underline">
              Drive this account from holdings
            </button>
          </div>
        )
      )}

      {error && (
        <p className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>
      )}

      {/* Add-holding row */}
      <div className="flex flex-wrap items-end gap-2 rounded-md border border-gray-700 bg-gray-900/40 p-3">
        <AddField label="Ticker" value={ticker} onChange={setTicker} width="w-28"
          onEnter={handleAdd} onBlur={handleTickerBlur} placeholder="VTI" />
        <AddField label="Shares" value={shares} onChange={setShares} width="w-24" onEnter={handleAdd} />
        <AddField label="Price" value={price} onChange={setPrice} width="w-24"
          onEnter={handleAdd} placeholder={fetchingPrice ? "fetching…" : undefined} />
        <AddField label="Cost basis" value={basis} onChange={setBasis} width="w-28" onEnter={handleAdd} />
        <button
          type="button"
          onClick={handleAdd}
          disabled={adding || ticker.trim() === ""}
          className="h-9 rounded-md bg-accent px-4 text-sm font-medium text-black hover:opacity-90 disabled:opacity-50"
        >
          {adding ? "Adding…" : "+ Add"}
        </button>
      </div>

      {/* Holdings table */}
      {loaded && rows.length === 0 ? (
        <p className="text-sm text-gray-400">No holdings yet. Add a ticker above.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-gray-700">
          <table className="w-full text-sm">
            <thead className="bg-gray-800 text-xs uppercase text-gray-400">
              <tr>
                <th className="px-2 py-2 text-left">Ticker</th>
                <th className="px-2 py-2 text-left">Name</th>
                <th className="px-2 py-2 text-right">Shares</th>
                <th className="px-2 py-2 text-right">Price</th>
                <th className="px-2 py-2 text-right">Market value</th>
                <th className="px-2 py-2 text-right">Cost basis</th>
                <th className="px-2 py-2 text-left">Asset class</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {rows.map((r) => {
                const chip = rowChip(r, assetClasses);
                const mv = parseFloat(r.shares) * parseFloat(r.price);
                return (
                  <Fragment key={r.id}>
                    <tr className="text-gray-200">
                      <td className="whitespace-nowrap px-2 py-2 font-medium">{r.displayTicker ?? "—"}</td>
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
                      <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">{money(mv)}</td>
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
                          className="text-gray-500 hover:text-red-400" aria-label="Delete holding">✕</button>
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
        <div className="space-y-1 rounded-md border border-gray-600 bg-gray-800 px-3 py-2">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium text-gray-300">Account value (derived)</span>
            <span className="font-semibold tabular-nums text-gray-100">{money(summary.value)}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-400">Cost basis (derived)</span>
            <span className="tabular-nums text-gray-300">{money(summary.basis)}</span>
          </div>
          <div className="border-t border-gray-700 pt-1 text-xs text-gray-400">
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
  if (kind === "locked") return `${base} bg-gray-800 text-gray-500 cursor-default`;
  const interactive = `${base} hover:opacity-80`;
  if (kind === "manual") return `${interactive} bg-accent/20 text-accent-ink`;
  if (kind === "needs_review") return `${interactive} bg-amber-500/20 text-amber-300`;
  return `${interactive} bg-gray-700 text-gray-200`;
}

function AddField({
  label, value, onChange, width, onEnter, onBlur, placeholder,
}: {
  label: string; value: string; onChange: (v: string) => void;
  width: string; onEnter: () => void; onBlur?: () => void; placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-gray-400">{label}</span>
      <input
        type="text"
        inputMode={label === "Ticker" ? "text" : "decimal"}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => onBlur?.()}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onEnter(); } }}
        className={`h-9 ${width} rounded-md border border-gray-600 bg-gray-800 px-2 text-sm text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent`}
      />
    </label>
  );
}

function CellInput({
  defaultValue, onCommit, align = "right", text = false, format,
}: {
  defaultValue: string; onCommit: (v: string) => void; align?: "left" | "right"; text?: boolean;
  /** Render this grouped/currency string when the cell is at rest; raw value while focused. */
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
      className={`h-7 w-full rounded-md border border-transparent bg-transparent px-1 text-${align} text-sm text-gray-100 ${text ? "" : "tabular-nums"} hover:border-gray-600 focus:border-accent focus:bg-gray-800 focus:outline-none`}
    />
  );
}
