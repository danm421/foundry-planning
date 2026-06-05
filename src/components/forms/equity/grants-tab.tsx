"use client";

import { useEffect, useState, useCallback } from "react";
import GrantCard, { type GrantDisplay } from "./grant-card";

interface GrantsTabProps {
  clientId: string;
  accountId: string | null;
}

type GrantType = "rsu" | "nqso" | "iso";

interface GrantEditorState {
  grantNumber: string;
  grantType: GrantType;
  grantDate: string;
  sharesGranted: string;
  has83bElection: boolean;
  fmvAtGrant: string;
  strikePrice: string;
  strikeDiscountPct: string;
  expirationDate: string;
  notes: string;
}

function emptyEditor(): GrantEditorState {
  return {
    grantNumber: "",
    grantType: "rsu",
    grantDate: "",
    sharesGranted: "",
    has83bElection: false,
    fmvAtGrant: "",
    strikePrice: "",
    strikeDiscountPct: "",
    expirationDate: "",
    notes: "",
  };
}

/** Parse decimal strings from API into numbers for display. */
function parseGrant(raw: Record<string, unknown>): GrantDisplay {
  const parseNum = (v: unknown) => (v != null ? parseFloat(String(v)) : null);
  const parseTranches = (arr: unknown[]): GrantDisplay["tranches"] =>
    arr.map((t) => {
      const tr = t as Record<string, unknown>;
      return {
        vestDate: String(tr.vestDate ?? ""),
        shares: parseFloat(String(tr.shares ?? "0")),
        sharesExercised: parseFloat(String(tr.sharesExercised ?? "0")),
        sharesSold: parseFloat(String(tr.sharesSold ?? "0")),
      };
    });

  return {
    id: String(raw.id),
    grantNumber: raw.grantNumber ? String(raw.grantNumber) : null,
    grantType: (raw.grantType as GrantType) ?? "rsu",
    grantDate: String(raw.grantDate ?? ""),
    sharesGranted: parseFloat(String(raw.sharesGranted ?? "0")),
    has83bElection: Boolean(raw.has83bElection),
    fmvAtGrant: parseNum(raw.fmvAtGrant),
    strikePrice: parseNum(raw.strikePrice),
    strikeDiscountPct: parseNum(raw.strikeDiscountPct),
    expirationDate: raw.expirationDate ? String(raw.expirationDate) : null,
    notes: raw.notes ? String(raw.notes) : null,
    tranches: Array.isArray(raw.tranches) ? parseTranches(raw.tranches) : [],
  };
}

/** Build grant-type-specific validation errors client-side so the server never 400s. */
function validateEditor(state: GrantEditorState): string | null {
  if (!state.grantDate) return "Grant date is required.";
  const shares = parseFloat(state.sharesGranted);
  if (isNaN(shares) || shares <= 0) return "Shares granted must be a positive number.";
  if (state.has83bElection && !state.fmvAtGrant) return "FMV at grant is required when 83(b) election is checked.";
  if (state.grantType === "nqso" || state.grantType === "iso") {
    if (!state.strikePrice && !state.strikeDiscountPct) {
      return "Strike price or strike discount % is required for NQSO/ISO grants.";
    }
    if (!state.expirationDate) return "Expiration date is required for NQSO/ISO grants.";
  }
  return null;
}

/** Build the POST/PUT body from editor state. Always sends tranches: [], plannedEvents: []. */
function buildBody(state: GrantEditorState) {
  return {
    grantNumber: state.grantNumber.trim() || null,
    grantType: state.grantType,
    grantDate: state.grantDate,
    sharesGranted: parseFloat(state.sharesGranted),
    has83bElection: state.has83bElection,
    fmvAtGrant: state.fmvAtGrant ? parseFloat(state.fmvAtGrant) : null,
    strikePrice: state.strikePrice ? parseFloat(state.strikePrice) : null,
    strikeDiscountPct: state.strikeDiscountPct ? parseFloat(state.strikeDiscountPct) / 100 : null,
    expirationDate: state.expirationDate || null,
    notes: state.notes.trim() || null,
    tranches: [],
    plannedEvents: [],
  };
}

const inputCls = "rounded border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-accent focus:outline-none w-full";
const labelCls = "block text-xs font-medium text-gray-400 mb-1";

function GrantEditor({
  initial,
  onSave,
  onCancel,
  saving,
  saveError,
}: {
  initial: GrantEditorState;
  onSave: (state: GrantEditorState) => void;
  onCancel: () => void;
  saving: boolean;
  saveError: string | null;
}) {
  const [state, setState] = useState<GrantEditorState>(initial);
  const set = (patch: Partial<GrantEditorState>) => setState((s) => ({ ...s, ...patch }));
  const validationError = validateEditor(state);

  return (
    <div className="rounded-md border border-gray-600 bg-gray-900 p-4 space-y-4">
      <h4 className="text-sm font-semibold text-gray-200">
        {initial.grantDate ? "Edit Grant" : "Add Grant"}
      </h4>

      {/* Grant type */}
      <div>
        <label className={labelCls}>Grant Type</label>
        <select
          value={state.grantType}
          onChange={(e) => {
            const grantType = e.target.value as GrantType;
            // Reset the fields that don't apply to the new type so we never
            // persist, e.g., has83bElection on an NQSO or a strike on an RSU.
            set(
              grantType === "rsu"
                ? { grantType, strikePrice: "", strikeDiscountPct: "", expirationDate: "" }
                : { grantType, has83bElection: false, fmvAtGrant: "" },
            );
          }}
          className={inputCls}
        >
          <option value="rsu">RSU</option>
          <option value="nqso">NQSO</option>
          <option value="iso">ISO</option>
        </select>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Grant number (optional) */}
        <div>
          <label className={labelCls}>Grant Number (optional)</label>
          <input
            type="text"
            value={state.grantNumber}
            onChange={(e) => set({ grantNumber: e.target.value })}
            placeholder="e.g. G-2024-001"
            className={inputCls}
          />
        </div>

        {/* Grant date */}
        <div>
          <label className={labelCls}>
            Grant Date <span className="text-red-400">*</span>
          </label>
          <input
            type="date"
            value={state.grantDate}
            onChange={(e) => set({ grantDate: e.target.value })}
            className={inputCls}
          />
        </div>

        {/* Shares granted */}
        <div>
          <label className={labelCls}>
            Shares Granted <span className="text-red-400">*</span>
          </label>
          <input
            type="number"
            min={0}
            value={state.sharesGranted}
            onChange={(e) => set({ sharesGranted: e.target.value })}
            placeholder="e.g. 10000"
            className={inputCls}
          />
        </div>
      </div>

      {/* RSU-specific: 83(b) election */}
      {state.grantType === "rsu" && (
        <div className="space-y-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={state.has83bElection}
              onChange={(e) => set({ has83bElection: e.target.checked })}
              className="h-4 w-4 rounded border-gray-600 bg-gray-800 text-accent focus:ring-accent"
            />
            <span className="text-sm text-gray-300">83(b) Election filed</span>
          </label>
          {state.has83bElection && (
            <div className="ml-6">
              <label className={labelCls}>
                FMV at Grant <span className="text-red-400">*</span>
              </label>
              <input
                type="number"
                min={0}
                step="0.0001"
                value={state.fmvAtGrant}
                onChange={(e) => set({ fmvAtGrant: e.target.value })}
                placeholder="e.g. 12.50"
                className={inputCls}
              />
            </div>
          )}
        </div>
      )}

      {/* NQSO/ISO-specific fields */}
      {(state.grantType === "nqso" || state.grantType === "iso") && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>
                Strike Price <span className="text-xs text-gray-500">(or use discount %)</span>
              </label>
              <input
                type="number"
                min={0}
                step="0.0001"
                value={state.strikePrice}
                onChange={(e) => set({ strikePrice: e.target.value })}
                placeholder="e.g. 15.00"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>
                Strike Discount % <span className="text-xs text-gray-500">(or use strike price)</span>
              </label>
              <input
                type="number"
                min={0}
                max={100}
                step="0.01"
                value={state.strikeDiscountPct}
                onChange={(e) => set({ strikeDiscountPct: e.target.value })}
                placeholder="e.g. 15"
                className={inputCls}
              />
            </div>
          </div>
          <div>
            <label className={labelCls}>
              Expiration Date <span className="text-red-400">*</span>
            </label>
            <input
              type="date"
              value={state.expirationDate}
              onChange={(e) => set({ expirationDate: e.target.value })}
              className={inputCls}
            />
          </div>
        </div>
      )}

      {/* Notes */}
      <div>
        <label className={labelCls}>Notes (optional)</label>
        <textarea
          value={state.notes}
          onChange={(e) => set({ notes: e.target.value })}
          rows={2}
          placeholder="Any additional notes..."
          className={`${inputCls} resize-none`}
        />
      </div>

      {/* Validation error */}
      {validationError && (
        <p className="text-xs text-amber-400">{validationError}</p>
      )}

      {/* Save error from API */}
      {saveError && (
        <p className="text-xs text-red-400">{saveError}</p>
      )}

      {/* Actions */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={saving || validationError !== null}
          onClick={() => onSave(state)}
          className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-on hover:bg-accent-deep disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save Grant"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-gray-600 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export default function GrantsTab({ clientId, accountId }: GrantsTabProps) {
  const [grants, setGrants] = useState<GrantDisplay[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingGrant, setEditingGrant] = useState<GrantDisplay | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const grantsUrl = accountId
    ? `/api/clients/${clientId}/stock-option-accounts/${accountId}/grants`
    : null;

  const loadGrants = useCallback(async () => {
    if (!grantsUrl) return;
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(grantsUrl);
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { grants: Record<string, unknown>[] };
      setGrants((data.grants ?? []).map(parseGrant));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [grantsUrl]);

  useEffect(() => {
    if (accountId) {
      void loadGrants();
    }
  }, [accountId, loadGrants]);

  if (accountId == null) {
    return (
      <p className="text-sm text-gray-400 italic">
        Save the account details first to add grants.
      </p>
    );
  }

  function openAddEditor() {
    setEditingGrant(null);
    setSaveError(null);
    setEditorOpen(true);
  }

  function openEditEditor(grant: GrantDisplay) {
    setEditingGrant(grant);
    setSaveError(null);
    setEditorOpen(true);
  }

  function closeEditor() {
    setEditorOpen(false);
    setEditingGrant(null);
    setSaveError(null);
  }

  function editorInitialState(): GrantEditorState {
    if (!editingGrant) return emptyEditor();
    return {
      grantNumber: editingGrant.grantNumber ?? "",
      grantType: editingGrant.grantType,
      grantDate: editingGrant.grantDate,
      sharesGranted: String(editingGrant.sharesGranted),
      has83bElection: editingGrant.has83bElection,
      fmvAtGrant: editingGrant.fmvAtGrant != null ? String(editingGrant.fmvAtGrant) : "",
      strikePrice: editingGrant.strikePrice != null ? String(editingGrant.strikePrice) : "",
      strikeDiscountPct:
        editingGrant.strikeDiscountPct != null
          ? String(editingGrant.strikeDiscountPct * 100)
          : "",
      expirationDate: editingGrant.expirationDate ?? "",
      notes: editingGrant.notes ?? "",
    };
  }

  async function handleSave(state: GrantEditorState) {
    if (!grantsUrl) return;
    setSaving(true);
    setSaveError(null);
    try {
      const body = buildBody(state);
      const isEdit = editingGrant != null;
      const url = isEdit ? `${grantsUrl}/${editingGrant.id}` : grantsUrl;
      const res = await fetch(url, {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      // Re-fetch the full list so we have the server-assigned IDs + timestamps
      await loadGrants();
      closeEditor();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(grantId: string) {
    if (!grantsUrl) return;
    setDeletingId(grantId);
    setLoadError(null);
    try {
      const res = await fetch(`${grantsUrl}/${grantId}`, { method: "DELETE" });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setLoadError(j.error ?? `Delete failed (HTTP ${res.status})`);
        return;
      }
      await loadGrants();
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-4">
      {loadError && (
        <p className="rounded bg-red-900/50 px-3 py-2 text-sm text-red-400">{loadError}</p>
      )}

      {loading && grants.length === 0 && (
        <p className="text-sm text-gray-400">Loading grants…</p>
      )}

      {!loading && grants.length === 0 && !editorOpen && (
        <p className="text-sm text-gray-400 italic">
          No grants yet. Add one below.
        </p>
      )}

      {/* Grant list */}
      {grants.length > 0 && (
        <div className="space-y-3">
          {grants.map((grant) => (
            <GrantCard
              key={grant.id}
              grant={grant}
              onEdit={() => openEditEditor(grant)}
              onDelete={() => {
                if (deletingId === grant.id) return;
                void handleDelete(grant.id);
              }}
            />
          ))}
        </div>
      )}

      {/* Grant editor (inline) */}
      {editorOpen && (
        <GrantEditor
          initial={editorInitialState()}
          onSave={handleSave}
          onCancel={closeEditor}
          saving={saving}
          saveError={saveError}
        />
      )}

      {/* Add grant button — hidden when editor is open */}
      {!editorOpen && (
        <button
          type="button"
          onClick={openAddEditor}
          className="text-sm text-accent hover:text-accent-ink"
        >
          + Add grant
        </button>
      )}
    </div>
  );
}
