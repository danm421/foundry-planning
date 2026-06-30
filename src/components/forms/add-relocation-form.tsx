"use client";

import { useState, useEffect, FormEvent } from "react";
import { useScenarioWriter } from "@/hooks/use-scenario-writer";
import DialogShell from "@/components/dialog-shell";
import { inputClassName, selectClassName, fieldLabelClassName } from "./input-styles";
import { USPS_STATE_CODES, USPS_STATE_NAMES } from "@/lib/usps-states";
import type { Relocation } from "@/engine/types";

export interface RelocationInitialData {
  id: string;
  name: string;
  year: number;
  destinationState: Relocation["destinationState"];
}

interface AddRelocationFormProps {
  clientId: string;
  initialData?: RelocationInitialData;
  onClose: () => void;
  onSaved: () => void;
  /** Solver draft mode — emit the engine object instead of persisting. */
  onSubmitDraft?: (technique: Relocation) => void;
}

function makeId(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `tmp-${Date.now()}`;
}

export default function AddRelocationForm({
  clientId,
  initialData,
  onClose,
  onSaved,
  onSubmitDraft,
}: AddRelocationFormProps) {
  const writer = useScenarioWriter(clientId);

  const defaultState = initialData?.destinationState ?? USPS_STATE_CODES[0];
  const defaultName = initialData?.name ?? `Move to ${USPS_STATE_NAMES[defaultState]}`;

  const [name, setName] = useState(defaultName);
  const [nameTouched, setNameTouched] = useState<boolean>(Boolean(initialData));
  const [year, setYear] = useState(
    initialData?.year ?? new Date().getFullYear() + 1,
  );
  const [destinationState, setDestinationState] =
    useState<Relocation["destinationState"]>(defaultState);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-name "Move to <State>" until the user types a custom name.
  useEffect(() => {
    if (!nameTouched) {
      setName(`Move to ${USPS_STATE_NAMES[destinationState]}`);
    }
  }, [destinationState, nameTouched]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    // ── Client-side validation ─────────────────────────────────────────────
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    const yearInt = Math.trunc(year);
    if (!Number.isFinite(yearInt) || yearInt < 2000 || yearInt > 2100) {
      setError("Year must be between 2000 and 2100.");
      return;
    }
    if (!USPS_STATE_CODES.includes(destinationState)) {
      setError("Select a valid destination state.");
      return;
    }

    const technique: Relocation = {
      id: initialData?.id ?? makeId(),
      name: name.trim(),
      year: yearInt,
      destinationState,
    };

    // ── Draft mode ────────────────────────────────────────────────────────
    if (onSubmitDraft) {
      onSubmitDraft(technique);
      return;
    }

    setSubmitting(true);
    try {
      const body = {
        name: technique.name,
        year: technique.year,
        destinationState: technique.destinationState,
      };

      const res = initialData
        ? await writer.submit(
            {
              op: "edit",
              targetKind: "relocation",
              targetId: initialData.id,
              desiredFields: body,
            },
            {
              url: `/api/clients/${clientId}/relocations`,
              method: "PUT",
              body: { relocationId: initialData.id, ...body },
            },
          )
        : await writer.submit(
            {
              op: "add",
              targetKind: "relocation",
              entity: { id: technique.id, ...body },
            },
            {
              url: `/api/clients/${clientId}/relocations`,
              method: "POST",
              body,
            },
          );

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setError(
          `Failed to save: ${(err as { error?: string }).error ?? res.statusText}`,
        );
        return;
      }

      onSaved();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <DialogShell
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={initialData ? "Edit Relocation" : "Add Relocation"}
      size="sm"
      primaryAction={{
        label: initialData ? "Save Changes" : "Add Relocation",
        form: "relocation-form",
        loading: submitting,
        disabled: submitting,
      }}
    >
      <form id="relocation-form" onSubmit={handleSubmit} className="space-y-5">
        {error && (
          <p
            role="alert"
            className="rounded-[var(--radius-sm)] border border-crit/40 bg-crit/10 px-3 py-2 text-[13px] text-crit"
          >
            {error}
          </p>
        )}

        {/* Destination state */}
        <div>
          <label className={fieldLabelClassName} htmlFor="relocation-state">
            Destination state <span className="text-crit">*</span>
          </label>
          <select
            id="relocation-state"
            value={destinationState}
            onChange={(e) =>
              setDestinationState(e.target.value as Relocation["destinationState"])
            }
            required
            className={selectClassName}
          >
            {USPS_STATE_CODES.map((code) => (
              <option key={code} value={code}>
                {USPS_STATE_NAMES[code]}
              </option>
            ))}
          </select>
        </div>

        {/* Name + Year row */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={fieldLabelClassName} htmlFor="relocation-name">
              Name <span className="text-crit">*</span>
            </label>
            <input
              id="relocation-name"
              value={name}
              onChange={(e) => {
                setNameTouched(true);
                setName(e.target.value);
              }}
              placeholder="e.g., Move to Florida"
              required
              className={inputClassName}
            />
          </div>
          <div>
            <label className={fieldLabelClassName} htmlFor="relocation-year">
              Year <span className="text-crit">*</span>
            </label>
            <input
              id="relocation-year"
              type="number"
              min={2000}
              max={2100}
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              required
              className={inputClassName}
            />
          </div>
        </div>
      </form>
    </DialogShell>
  );
}
