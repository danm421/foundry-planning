"use client";

import { useEffect } from "react";
import { clampToViewport } from "./clamp-to-viewport";

export type TrustDropOption =
  | "already_owned"
  | "gift_this_year"
  | "bequest_client"
  | "bequest_spouse"
  | "sale_to_trust";

interface Props {
  anchor: { clientX: number; clientY: number };
  assetName: string;
  trustName: string;
  clientFirstName: string;
  spouseFirstName: string | null;
  onSelect: (option: TrustDropOption) => void;
  onCancel: () => void;
}

export function TrustDropChooser({
  anchor,
  assetName,
  trustName,
  clientFirstName,
  spouseFirstName,
  onSelect,
  onCancel,
}: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const { left, top } = clampToViewport(anchor, 320, 360);

  return (
    <div
      role="dialog"
      aria-label={`Move ${assetName} to ${trustName}`}
      className="fixed inset-0 z-50"
    >
      <button
        data-testid="trust-drop-chooser-backdrop"
        aria-label="Cancel"
        onClick={onCancel}
        className="absolute inset-0 cursor-default bg-transparent"
      />
      <div
        style={{ left, top }}
        className="absolute w-[300px] rounded-md border border-[var(--color-hair-2)] bg-[var(--color-card)] p-1 shadow-xl"
      >
        <header className="border-b border-[var(--color-hair)] px-3 py-2 text-xs text-[var(--color-ink-3)]">
          Move <span className="font-medium text-[var(--color-ink)]">{assetName}</span>
          {" → "}
          <span className="font-medium text-[var(--color-ink)]">{trustName}</span>
        </header>
        <ul className="py-1">
          <Option label="Already owned" sub="No tax effect — pure data correction" onClick={() => onSelect("already_owned")} />
          <Option label="Gift this year" sub="Records a gift at current FMV" onClick={() => onSelect("gift_this_year")} />
          <Option
            label={`Bequest at ${clientFirstName}'s death`}
            sub="Adds a will bequest to the trust"
            onClick={() => onSelect("bequest_client")}
          />
          {spouseFirstName && (
            <Option
              label={`Bequest at ${spouseFirstName}'s death`}
              sub="Adds a will bequest to the trust"
              onClick={() => onSelect("bequest_spouse")}
            />
          )}
          <Option
            label="Sale to trust for note"
            sub="Coming soon"
            disabled
            onClick={() => {}}
          />
        </ul>
      </div>
    </div>
  );
}

function Option({
  label,
  sub,
  disabled,
  onClick,
}: {
  label: string;
  sub: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        className={`flex w-full flex-col items-start gap-0.5 rounded px-3 py-2 text-left text-sm hover:bg-[var(--color-card-hover)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent ${
          disabled ? "text-[var(--color-ink-3)]" : "text-[var(--color-ink)]"
        }`}
      >
        <span>{label}</span>
        <span className="text-xs text-[var(--color-ink-3)]">{sub}</span>
      </button>
    </li>
  );
}
