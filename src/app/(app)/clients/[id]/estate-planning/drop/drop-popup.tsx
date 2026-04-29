"use client";

import { useEffect, useState } from "react";
import { clampToViewport } from "../popovers/clamp-to-viewport";
import { GiftSubForm, type GiftSubFormSubmit } from "./gift-sub-form";
import { BequestSubForm } from "./bequest-sub-form";
import { RetitleSubForm } from "./retitle-sub-form";

/**
 * Unified drop-target popup. Wraps the three sub-forms (Gift / Bequest /
 * Retitle) behind a single type chooser. The composer is a pure UI router:
 *
 * - It owns the type-chooser radios + dialog chrome (header, backdrop, escape).
 * - It does NOT call save-handlers itself. Each sub-form's submit is
 *   normalized into a `DropAction` and forwarded to `onSave`. The parent
 *   (`dnd-context-provider`) is responsible for wiring `DropAction` →
 *   `saveGiftOneTime` / `saveGiftRecurring` / `saveBequest` / `saveRetitle`,
 *   because the parent has the scenario context (currentOwners, existing wills,
 *   client/spouse grantor mapping) the composer doesn't.
 */
export interface DropPopupProps {
  anchor: { clientX: number; clientY: number };
  source: {
    accountId: string;
    accountName: string;
    accountCategory: string;
    isCash: boolean;
    ownerKind: "family_member" | "entity";
    ownerId: string;
    /** Display label — e.g. "Tom", "Linda", "SLAT". */
    ownerLabel: string;
    /** Owner's stake in the account, fractional 0–1 (DB convention). */
    ownerSlicePct: number;
    /** Today's $ value of the owner's slice. Drives the live $-preview. */
    ownerSliceValueToday: number;
  };
  target: {
    kind: "entity" | "family_member" | "external_beneficiary";
    id: string;
    label: string;
    isCharity: boolean;
  };
  growthRateForPreview: number;
  yearMin: number;
  yearMax: number;
  /**
   * `true` when the household has a spouse family member. Threaded from
   * `dnd-context-provider` so the BequestSubForm can show / hide the
   * whose-will radios. Required so the parent must thread it explicitly.
   */
  spouseAvailable: boolean;
  onSave: (action: DropAction) => Promise<void>;
  onCancel: () => void;
}

export type DropAction =
  | {
      kind: "gift-one-time";
      year: number;
      sliceFraction: number;
      useCrummey: boolean;
      overrideAmount?: number;
      notes?: string;
    }
  | {
      kind: "gift-recurring";
      startYear: number;
      endYear: number;
      annualAmount: number;
      inflationAdjust: boolean;
      useCrummey: boolean;
    }
  | {
      kind: "bequest";
      grantorMode: "client" | "spouse" | "both";
      sliceFraction: number;
      condition: "always" | "if_spouse_survives" | "if_spouse_predeceased";
    }
  // Retitle composer emits sliceFraction only — the parent supplies
  // currentOwners, moveFrom, moveTo from its scenario context when invoking
  // saveRetitle. See class-doc above.
  | { kind: "retitle"; sliceFraction: number };

type DropType = "gift" | "bequest" | "retitle";

const POPUP_WIDTH = 480;
const POPUP_HEIGHT = 460;

export function DropPopup(props: DropPopupProps) {
  const {
    anchor,
    source,
    target,
    growthRateForPreview,
    yearMin,
    yearMax,
    spouseAvailable,
    onSave,
    onCancel,
  } = props;

  const [type, setType] = useState<DropType>("gift");

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const { left, top } = clampToViewport(anchor, POPUP_WIDTH, POPUP_HEIGHT);
  const slicePctRounded = Math.round(source.ownerSlicePct * 100);

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        data-testid="drop-popup-backdrop"
        aria-label="Cancel"
        onClick={onCancel}
        className="absolute inset-0 cursor-default bg-black/30"
      />
      <div
        role="dialog"
        aria-label={`Transfer ${source.ownerLabel}'s slice of ${source.accountName}`}
        style={{ left, top, width: POPUP_WIDTH }}
        className="absolute rounded-md border-2 border-[var(--color-ink-3)] ring-1 ring-black/60 bg-[var(--color-card)] shadow-xl"
      >
        <header className="flex items-baseline justify-between border-b border-[var(--color-hair)] px-3 py-2">
          <h3 className="text-sm font-medium text-[var(--color-ink)]">
            Transfer {source.ownerLabel}&rsquo;s {slicePctRounded}% of{" "}
            {source.accountName}
          </h3>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close"
            className="text-[var(--color-ink-3)] hover:text-[var(--color-ink)]"
          >
            ✕
          </button>
        </header>
        <p className="px-3 pt-2 text-xs text-[var(--color-ink-3)]">
          To: <span className="text-[var(--color-ink)]">{target.label}</span>
        </p>

        <fieldset
          role="radiogroup"
          aria-label="Transfer type"
          className="flex gap-4 px-3 pt-2"
        >
          <label className="flex items-center gap-1 text-xs text-[var(--color-ink)]">
            <input
              type="radio"
              name="drop-popup-type"
              value="gift"
              checked={type === "gift"}
              onChange={() => setType("gift")}
            />
            Gift
          </label>
          <label className="flex items-center gap-1 text-xs text-[var(--color-ink)]">
            <input
              type="radio"
              name="drop-popup-type"
              value="bequest"
              checked={type === "bequest"}
              onChange={() => setType("bequest")}
            />
            Bequest at death
          </label>
          {!target.isCharity && (
            <label className="flex items-center gap-1 text-xs text-[var(--color-ink)]">
              <input
                type="radio"
                name="drop-popup-type"
                value="retitle"
                checked={type === "retitle"}
                onChange={() => setType("retitle")}
              />
              Retitle
            </label>
          )}
        </fieldset>

        {target.isCharity && !source.isCash && (
          <p className="px-3 pt-2 text-[11px] text-[var(--color-ink-3)]">
            Charitable gift creates an income-tax deduction subject to AGI
            limits.
          </p>
        )}

        {type === "gift" && (
          <GiftSubForm
            ownerSlicePct={source.ownerSlicePct}
            ownerSliceValueAtToday={source.ownerSliceValueToday}
            growthRateForPreview={growthRateForPreview}
            recipientKind={target.kind}
            isCashAccount={source.isCash}
            yearMin={yearMin}
            yearMax={yearMax}
            onSubmit={(p: GiftSubFormSubmit) => {
              if (p.kind === "one-time") {
                void onSave({
                  kind: "gift-one-time",
                  year: p.year,
                  sliceFraction: p.sliceFraction,
                  useCrummey: p.useCrummey,
                  overrideAmount: p.overrideAmount,
                  notes: p.notes,
                });
              } else {
                void onSave({
                  kind: "gift-recurring",
                  startYear: p.startYear,
                  endYear: p.endYear,
                  annualAmount: p.annualAmount,
                  inflationAdjust: p.inflationAdjust,
                  useCrummey: p.useCrummey,
                });
              }
            }}
            onCancel={onCancel}
          />
        )}
        {type === "bequest" && (
          <BequestSubForm
            ownerSlicePct={source.ownerSlicePct}
            isJointOrFractional={source.ownerSlicePct < 1}
            spouseAvailable={spouseAvailable}
            recipientKind={target.kind}
            onSubmit={(p) => {
              void onSave({ kind: "bequest", ...p });
            }}
            onCancel={onCancel}
          />
        )}
        {type === "retitle" && (
          <RetitleSubForm
            ownerSlicePct={source.ownerSlicePct}
            recipientKind={target.kind}
            onSubmit={(p) => {
              void onSave({ kind: "retitle", ...p });
            }}
            onCancel={onCancel}
          />
        )}
      </div>
    </div>
  );
}
