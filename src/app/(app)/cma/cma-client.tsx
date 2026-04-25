"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  ASSET_TYPE_IDS,
  ASSET_TYPE_LABELS,
  type AssetTypeId,
} from "@/lib/investments/asset-types";
import { TrashIcon } from "@/components/icons";

interface AssetClass {
  id: string;
  name: string;
  geometricReturn: string;
  arithmeticMean: string;
  volatility: string;
  pctOrdinaryIncome: string;
  pctLtCapitalGains: string;
  pctQualifiedDividends: string;
  pctTaxExempt: string;
  sortOrder: number;
  assetType: AssetTypeId;
}

interface Allocation {
  id: string;
  modelPortfolioId: string;
  assetClassId: string;
  weight: string;
}

interface ModelPortfolio {
  id: string;
  name: string;
  description: string | null;
  allocations: Allocation[];
}

type Tab = "asset-classes" | "model-portfolios";

// Decimal (0.075) → display percentage ("7.5"). Round to 4dp to dodge IEEE-754
// noise (0.075 * 100 → 7.500000000000001), then strip trailing zeros so the
// displayed value matches what the user typed and `value` doesn't repaint
// mid-edit.
const pct = (v: string) => {
  const n = Number(v) * 100;
  if (!Number.isFinite(n)) return "0";
  return parseFloat(n.toFixed(4)).toString();
};
const toDec = (v: string) => String(Number(v) / 100);

// Percentage input that holds the in-progress display string in local state so
// each parent re-render doesn't re-pad the value (which previously clobbered
// the cursor and capped typing at one digit). We track our own committed value
// in a ref so the sync effect ignores echoes of our own onChange, and only
// re-derives the draft when the parent value changes for some external reason
// (e.g., the "Est" button writing arithmeticMean).
function PercentInput({
  decimalValue,
  onChange,
  onBlur,
  className,
}: {
  decimalValue: string;
  onChange: (decimal: string) => void;
  onBlur?: () => void;
  className?: string;
}) {
  const [draft, setDraft] = useState(() => pct(decimalValue));
  const lastCommittedRef = useRef(decimalValue);

  useEffect(() => {
    if (decimalValue !== lastCommittedRef.current) {
      lastCommittedRef.current = decimalValue;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: external resets (e.g. the "Est" button) need to refresh the draft; our own onChange echoes are filtered via lastCommittedRef.
      setDraft(pct(decimalValue));
    }
  }, [decimalValue]);

  return (
    <input
      type="number"
      step="0.01"
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        const next = toDec(e.target.value);
        lastCommittedRef.current = next;
        onChange(next);
      }}
      onBlur={onBlur}
      className={className}
    />
  );
}

export default function CmaClient() {
  const [tab, setTab] = useState<Tab>("asset-classes");
  const [assetClasses, setAssetClasses] = useState<AssetClass[]>([]);
  const [portfolios, setPortfolios] = useState<ModelPortfolio[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seedError, setSeedError] = useState<string | null>(null);
  // Guard against React strict-mode double-mount re-firing the seed request.
  const fetchInFlight = useRef(false);

  const fetchData = useCallback(async () => {
    if (fetchInFlight.current) return;
    fetchInFlight.current = true;
    setLoading(true);
    setSeedError(null);
    try {
      // Layer 3 safety net. If the Clerk webhook or future signup-handler
      // inline call already seeded this firm, this POST is a near no-op
      // (returns 201 with inserted counts of 0).
      const seedRes = await fetch("/api/cma/seed", { method: "POST" });
      if (!seedRes.ok) {
        let detail = `status ${seedRes.status}`;
        try {
          const body = (await seedRes.json()) as { error?: string };
          if (body.error) detail = body.error;
        } catch {
          // non-JSON response — keep the status-only detail
        }
        setSeedError(detail);
        // Still try to fetch existing rows — the firm may have been
        // partially seeded by a prior call and we don't want a blank page
        // on top of a banner if data actually exists.
      }

      const [acRes, mpRes] = await Promise.all([
        fetch("/api/cma/asset-classes"),
        fetch("/api/cma/model-portfolios"),
      ]);
      if (acRes.ok) setAssetClasses(await acRes.json());
      if (mpRes.ok) setPortfolios(await mpRes.json());
    } catch {
      setError("Failed to load CMA data");
    } finally {
      setLoading(false);
      fetchInFlight.current = false;
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  async function saveAssetClass(ac: AssetClass) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/cma/asset-classes/${ac.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: ac.name,
          geometricReturn: ac.geometricReturn,
          arithmeticMean: ac.arithmeticMean,
          volatility: ac.volatility,
          pctOrdinaryIncome: ac.pctOrdinaryIncome,
          pctLtCapitalGains: ac.pctLtCapitalGains,
          pctQualifiedDividends: ac.pctQualifiedDividends,
          pctTaxExempt: ac.pctTaxExempt,
          sortOrder: ac.sortOrder,
          assetType: ac.assetType,
        }),
      });
      if (!res.ok) throw new Error("Save failed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function addAssetClass() {
    try {
      const res = await fetch("/api/cma/asset-classes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "New Asset Class",
          sortOrder: assetClasses.length,
          assetType: "other",
        }),
      });
      if (res.ok) {
        const created = await res.json();
        setAssetClasses((prev) => [...prev, created]);
      }
    } catch {
      setError("Failed to add asset class");
    }
  }

  async function deleteAssetClass(id: string) {
    try {
      await fetch(`/api/cma/asset-classes/${id}`, { method: "DELETE" });
      setAssetClasses((prev) => prev.filter((ac) => ac.id !== id));
    } catch {
      setError("Failed to delete");
    }
  }

  function updateAcField(id: string, field: keyof AssetClass, value: string) {
    setAssetClasses((prev) =>
      prev.map((ac) => (ac.id === id ? { ...ac, [field]: value } : ac))
    );
  }

  if (loading) {
    return <div className="py-12 text-center text-gray-400">Loading CMA data...</div>;
  }

  return (
    <div>
      {seedError && (
        <div
          role="alert"
          className="mb-4 flex items-start justify-between gap-4 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
        >
          <div>
            <p className="font-medium">
              We couldn&apos;t set up your default capital-market assumptions.
            </p>
            <p className="mt-1 text-amber-800">
              {seedError}. If this persists, contact support.
            </p>
          </div>
          <button
            type="button"
            onClick={() => fetchData()}
            className="whitespace-nowrap rounded border border-amber-400 bg-white px-3 py-1 font-medium text-amber-900 hover:bg-amber-100"
          >
            Retry
          </button>
        </div>
      )}
      {error && <p className="mb-4 rounded bg-red-900/50 px-3 py-2 text-sm text-red-400">{error}</p>}

      {/* Tab toggle */}
      <div className="mb-6 flex gap-1 rounded-lg bg-gray-800/50 p-1">
        <button
          onClick={() => setTab("asset-classes")}
          className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
            tab === "asset-classes" ? "bg-gray-700 text-white" : "text-gray-400 hover:text-gray-200"
          }`}
        >
          Asset Classes
        </button>
        <button
          onClick={() => setTab("model-portfolios")}
          className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
            tab === "model-portfolios" ? "bg-gray-700 text-white" : "text-gray-400 hover:text-gray-200"
          }`}
        >
          Model Portfolios
        </button>
      </div>

      {tab === "asset-classes" && (
        <AssetClassesTab
          assetClasses={assetClasses}
          onUpdate={updateAcField}
          onSave={saveAssetClass}
          onAdd={addAssetClass}
          onDelete={deleteAssetClass}
          saving={saving}
        />
      )}

      {tab === "model-portfolios" && (
        <ModelPortfoliosTab
          portfolios={portfolios}
          assetClasses={assetClasses}
          onRefresh={fetchData}
        />
      )}
    </div>
  );
}

// ── Asset Classes Tab ─────────────────────────────────────────────────────────

interface AssetClassesTabProps {
  assetClasses: AssetClass[];
  onUpdate: (id: string, field: keyof AssetClass, value: string) => void;
  onSave: (ac: AssetClass) => Promise<void>;
  onAdd: () => void;
  onDelete: (id: string) => void;
  saving: boolean;
}

function AssetClassesTab({ assetClasses, onUpdate, onSave, onAdd, onDelete, saving }: AssetClassesTabProps) {
  return (
    <div>
      <div className="overflow-x-auto rounded-lg border border-gray-700">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-700 bg-gray-800/60 text-left text-xs font-medium uppercase tracking-wider text-gray-400">
              <th className="min-w-[14rem] px-3 py-2">Name</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2 text-right">Geo Return %</th>
              <th className="px-3 py-2 text-right">Arith Mean %</th>
              <th className="px-3 py-2 text-right">Volatility %</th>
              <th className="px-3 py-2 text-right">OI %</th>
              <th className="px-3 py-2 text-right">LT CG %</th>
              <th className="px-3 py-2 text-right">Q Div %</th>
              <th className="px-3 py-2 text-right">Tax-Ex %</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {assetClasses.map((ac) => (
              <AssetClassRow key={ac.id} ac={ac} onUpdate={onUpdate} onSave={onSave} onDelete={onDelete} saving={saving} />
            ))}
          </tbody>
        </table>
      </div>

      <button
        onClick={onAdd}
        className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
      >
        + Add Asset Class
      </button>
    </div>
  );
}

function AssetClassRow({
  ac,
  onUpdate,
  onSave,
  onDelete,
}: {
  ac: AssetClass;
  onUpdate: (id: string, field: keyof AssetClass, value: string) => void;
  onSave: (ac: AssetClass) => Promise<void>;
  onDelete: (id: string) => void;
  saving: boolean;
}) {
  const pctFields: (keyof AssetClass)[] = [
    "geometricReturn",
    "arithmeticMean",
    "volatility",
    "pctOrdinaryIncome",
    "pctLtCapitalGains",
    "pctQualifiedDividends",
    "pctTaxExempt",
  ];

  return (
    <tr className="hover:bg-gray-800/30">
      <td className="px-3 py-2">
        <input
          type="text"
          value={ac.name}
          onChange={(e) => onUpdate(ac.id, "name", e.target.value)}
          onBlur={() => onSave(ac)}
          className="w-full rounded border border-gray-700 bg-transparent px-2 py-1 text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
        />
      </td>
      <td className="px-3 py-2">
        <select
          value={ac.assetType}
          onChange={(e) => {
            onUpdate(ac.id, "assetType", e.target.value);
            // Use the freshly-chosen value — the state update above is async
            // and the immediate onSave would read the stale row.
            onSave({ ...ac, assetType: e.target.value as AssetTypeId });
          }}
          className="rounded border border-gray-700 bg-gray-900 px-2 py-1 text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
        >
          {ASSET_TYPE_IDS.map((id) => (
            <option key={id} value={id}>{ASSET_TYPE_LABELS[id]}</option>
          ))}
        </select>
      </td>
      {pctFields.map((field) => (
        <td key={field} className="px-3 py-2">
          <div className="flex items-center justify-end gap-1">
            <PercentInput
              decimalValue={ac[field] as string}
              onChange={(next) => onUpdate(ac.id, field, next)}
              onBlur={() => onSave(ac)}
              className="w-16 rounded border border-gray-700 bg-transparent px-2 py-1 text-right text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
            />
            {field === "arithmeticMean" && (
              <button
                type="button"
                onClick={() => {
                  // Lognormal approximation (eMoney whitepaper p.4):
                  //   Arith ≈ Geo + SD² / 2
                  // All values stored as decimals (0.07 = 7%).
                  const gm = parseFloat(ac.geometricReturn);
                  const sd = parseFloat(ac.volatility);
                  if (!Number.isFinite(gm) || !Number.isFinite(sd)) return;
                  const estimated = gm + (sd * sd) / 2;
                  const next = estimated.toFixed(4);
                  onUpdate(ac.id, "arithmeticMean", next);
                  onSave({ ...ac, arithmeticMean: next });
                }}
                title="Estimate from Geometric Return and Standard Deviation (Arith ≈ Geo + SD²/2)"
                className="rounded border border-gray-700 px-1.5 py-0.5 text-[10px] text-gray-400 hover:border-blue-500 hover:text-gray-100"
              >
                Est
              </button>
            )}
          </div>
        </td>
      ))}
      <td className="px-3 py-2">
        <button
          onClick={() => onDelete(ac.id)}
          className="rounded p-1 text-gray-500 hover:bg-red-500/10 hover:text-red-400"
          title="Delete asset class"
          aria-label="Delete asset class"
        >
          <TrashIcon className="h-4 w-4" />
        </button>
      </td>
    </tr>
  );
}

// ── Model Portfolios Tab ──────────────────────────────────────────────────────

interface ModelPortfoliosTabProps {
  portfolios: ModelPortfolio[];
  assetClasses: AssetClass[];
  onRefresh: () => void;
}

function ModelPortfoliosTab({ portfolios, assetClasses, onRefresh }: ModelPortfoliosTabProps) {
  const [selectedId, setSelectedId] = useState<string | null>(portfolios[0]?.id ?? null);
  const [error, setError] = useState<string | null>(null);

  const selected = portfolios.find((p) => p.id === selectedId) ?? null;

  async function addPortfolio() {
    try {
      const res = await fetch("/api/cma/model-portfolios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "New Portfolio" }),
      });
      if (res.ok) {
        onRefresh();
      }
    } catch {
      setError("Failed to create portfolio");
    }
  }

  async function deletePortfolio(id: string) {
    try {
      await fetch(`/api/cma/model-portfolios/${id}`, { method: "DELETE" });
      if (selectedId === id) setSelectedId(null);
      onRefresh();
    } catch {
      setError("Failed to delete portfolio");
    }
  }

  async function saveAllocations(portfolioId: string, allocations: { assetClassId: string; weight: string }[]) {
    setError(null);
    try {
      const res = await fetch(`/api/cma/model-portfolios/${portfolioId}/allocations`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allocations }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Save failed");
      }
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    }
  }

  // Compute blended stats for the selected portfolio
  const blended = selected
    ? (() => {
        const result = { geoReturn: 0, arithMean: 0, vol: 0, oi: 0, ltcg: 0, qdiv: 0, taxEx: 0 };
        const acMap = new Map(assetClasses.map((ac) => [ac.id, ac]));
        for (const alloc of selected.allocations) {
          const ac = acMap.get(alloc.assetClassId);
          if (!ac) continue;
          const w = Number(alloc.weight);
          result.geoReturn += w * Number(ac.geometricReturn);
          result.arithMean += w * Number(ac.arithmeticMean);
          result.vol += w * Number(ac.volatility);
          result.oi += w * Number(ac.pctOrdinaryIncome);
          result.ltcg += w * Number(ac.pctLtCapitalGains);
          result.qdiv += w * Number(ac.pctQualifiedDividends);
          result.taxEx += w * Number(ac.pctTaxExempt);
        }
        return result;
      })()
    : null;

  const totalWeight = selected
    ? selected.allocations.reduce((s, a) => s + Number(a.weight), 0)
    : 0;

  return (
    <div className="flex gap-6">
      {/* Portfolio list */}
      <div className="w-56 flex-shrink-0 space-y-2">
        {portfolios.map((p) => (
          <div
            key={p.id}
            onClick={() => setSelectedId(p.id)}
            className={`cursor-pointer rounded-lg border px-3 py-2 text-sm ${
              selectedId === p.id
                ? "border-blue-500 bg-blue-500/10 text-blue-300"
                : "border-gray-700 text-gray-300 hover:border-gray-600"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="truncate font-medium">{p.name}</span>
              <button
                onClick={(e) => { e.stopPropagation(); deletePortfolio(p.id); }}
                className="rounded p-1 text-gray-500 hover:bg-red-500/10 hover:text-red-400"
                title="Delete portfolio"
                aria-label="Delete portfolio"
              >
                <TrashIcon className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}
        <button
          onClick={addPortfolio}
          className="w-full rounded-lg border border-dashed border-gray-600 px-3 py-2 text-sm text-gray-400 hover:border-gray-500 hover:text-gray-300"
        >
          + New Portfolio
        </button>
      </div>

      {/* Portfolio detail */}
      {selected && (
        <div className="flex-1 space-y-4">
          {error && <p className="rounded bg-red-900/50 px-3 py-2 text-sm text-red-400">{error}</p>}

          {/* Blended summary */}
          {blended && totalWeight > 0 && (
            <div className="grid grid-cols-4 gap-3 rounded-lg border border-gray-700 bg-gray-800/40 p-4">
              <div>
                <p className="text-xs text-gray-500">Blended Geo Return</p>
                <p className="text-lg font-semibold text-gray-100">{(blended.geoReturn * 100).toFixed(2)}%</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Arith Mean</p>
                <p className="text-lg font-semibold text-gray-100">{(blended.arithMean * 100).toFixed(2)}%</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Volatility</p>
                <p className="text-lg font-semibold text-gray-100">{(blended.vol * 100).toFixed(2)}%</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Realization</p>
                <p className="text-xs text-gray-300">
                  OI {(blended.oi * 100).toFixed(0)}% | CG {(blended.ltcg * 100).toFixed(0)}% | Div {(blended.qdiv * 100).toFixed(0)}% | Ex {(blended.taxEx * 100).toFixed(0)}%
                </p>
              </div>
            </div>
          )}

          {/* Allocation table */}
          <PortfolioAllocationEditor
            portfolio={selected}
            assetClasses={assetClasses}
            onSave={(allocs) => saveAllocations(selected.id, allocs)}
          />
        </div>
      )}
    </div>
  );
}

function PortfolioAllocationEditor({
  portfolio,
  assetClasses,
  onSave,
}: {
  portfolio: ModelPortfolio;
  assetClasses: AssetClass[];
  onSave: (allocs: { assetClassId: string; weight: string }[]) => void;
}) {
  const [allocs, setAllocs] = useState(
    portfolio.allocations.map((a) => ({
      assetClassId: a.assetClassId,
      weight: (Number(a.weight) * 100).toFixed(2),
    }))
  );

  // Reset when portfolio changes
  useEffect(() => {
    setAllocs(
      portfolio.allocations.map((a) => ({
        assetClassId: a.assetClassId,
        weight: (Number(a.weight) * 100).toFixed(2),
      }))
    );
  }, [portfolio.id, portfolio.allocations]);

  const currentTotal = allocs.reduce((s, a) => s + Number(a.weight), 0);
  const usedClassIds = new Set(allocs.map((a) => a.assetClassId));
  const availableClasses = assetClasses.filter((ac) => !usedClassIds.has(ac.id));

  function addRow(classId: string) {
    setAllocs((prev) => [...prev, { assetClassId: classId, weight: "0" }]);
  }

  function removeRow(idx: number) {
    setAllocs((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateWeight(idx: number, value: string) {
    setAllocs((prev) => prev.map((a, i) => (i === idx ? { ...a, weight: value } : a)));
  }

  function handleSave() {
    onSave(allocs.map((a) => ({ assetClassId: a.assetClassId, weight: String(Number(a.weight) / 100) })));
  }

  const acMap = new Map(assetClasses.map((ac) => [ac.id, ac]));

  return (
    <div>
      <div className="overflow-x-auto rounded-lg border border-gray-700">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-700 bg-gray-800/60 text-left text-xs font-medium uppercase tracking-wider text-gray-400">
              <th className="px-3 py-2">Asset Class</th>
              <th className="px-3 py-2 text-right">Growth Rate %</th>
              <th className="px-3 py-2 text-right">Weight %</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {allocs.map((a, idx) => {
              const ac = acMap.get(a.assetClassId);
              const growth = ac
                ? parseFloat((Number(ac.geometricReturn) * 100).toFixed(4)).toString()
                : "—";
              return (
                <tr key={a.assetClassId} className="hover:bg-gray-800/30">
                  <td className="px-3 py-2 text-gray-200">{ac?.name ?? "Unknown"}</td>
                  <td className="px-3 py-2 text-right text-sm text-gray-300">{growth}</td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end">
                      <input
                        type="number"
                        step="0.01"
                        value={a.weight}
                        onChange={(e) => updateWeight(idx, e.target.value)}
                        className="w-24 rounded border border-gray-700 bg-transparent px-2 py-1 text-right text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
                      />
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <button
                      onClick={() => removeRow(idx)}
                      className="rounded p-1 text-gray-500 hover:bg-red-500/10 hover:text-red-400"
                      title="Remove asset class from portfolio"
                      aria-label="Remove asset class from portfolio"
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {availableClasses.length > 0 && (
            <select
              onChange={(e) => { if (e.target.value) addRow(e.target.value); e.target.value = ""; }}
              className="rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-300"
              defaultValue=""
            >
              <option value="" disabled>+ Add asset class...</option>
              {availableClasses.map((ac) => (
                <option key={ac.id} value={ac.id}>{ac.name}</option>
              ))}
            </select>
          )}
          <span className={`text-sm ${Math.abs(currentTotal - 100) < 0.1 ? "text-green-400" : "text-amber-400"}`}>
            Total: {currentTotal.toFixed(2)}%
          </span>
        </div>
        <button
          onClick={handleSave}
          disabled={Math.abs(currentTotal - 100) > 0.1}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          Save Allocations
        </button>
      </div>
    </div>
  );
}
