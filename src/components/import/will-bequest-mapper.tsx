"use client";

import type {
  WillAssetMode,
  WillBequestKind,
  WillCondition,
  WillRecipientKind,
} from "@/lib/imports/commit/will-types";
import type { ExtractedWillBequest } from "@/lib/extraction/types";

/**
 * Wizard-internal bequest shape: extracted hints (read-only) + the
 * fields the advisor must resolve before commit. Single-recipient
 * simplification — the schema supports many but the wizard collects
 * one and the commit module expands it into the recipients[] array
 * at 100%.
 */
export interface WizardBequest {
  // From extraction — never overwritten:
  recipientNameHint: string;
  assetDescriptionHint: string;
  percentage: number;

  // Wizard-resolved:
  /** Display name; defaults to assetDescriptionHint when committing. */
  name?: string;
  kind?: WillBequestKind;
  assetMode?: WillAssetMode;
  accountId?: string | null;
  liabilityId?: string | null;
  condition?: WillCondition;
  recipientKind?: WillRecipientKind;
  recipientId?: string | null;

  // UI-only flag:
  discarded?: boolean;
}

export interface RecipientOption {
  kind: WillRecipientKind;
  /** null only when kind === 'spouse'. */
  id: string | null;
  label: string;
}

export interface AssetOption {
  kind: WillBequestKind;
  /**
   * null when (kind='asset' AND assetMode='all_assets'). Otherwise the
   * accountId or liabilityId FK that the commit module expects.
   */
  id: string | null;
  assetMode?: WillAssetMode;
  label: string;
}

const CONDITION_OPTIONS: { value: WillCondition; label: string }[] = [
  { value: "always", label: "Always" },
  { value: "if_spouse_survives", label: "Only if spouse survives" },
  { value: "if_spouse_predeceased", label: "Only if spouse predeceased" },
];

interface WillBequestMapperProps {
  bequest: WizardBequest;
  recipientOptions: RecipientOption[];
  assetOptions: AssetOption[];
  onChange: (next: WizardBequest) => void;
  onDiscard: () => void;
  onUndiscard: () => void;
}

const SELECT_CLASS =
  "w-full rounded border border-gray-600 bg-gray-800 px-2 py-1.5 text-sm text-gray-300 focus:border-accent focus:outline-none";
const SELECT_EMPTY =
  `${SELECT_CLASS} border-amber-600/50 bg-amber-900/20`;
const INPUT_CLASS =
  "w-full rounded border border-gray-600 bg-gray-800 px-2 py-1.5 text-sm text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent";

/**
 * Returns true if the bequest is either discarded (skipped on commit)
 * or has every required FK / kind / recipient resolved.
 */
export function isBequestResolved(b: WizardBequest): boolean {
  if (b.discarded) return true;
  if (!b.kind) return false;
  if (!b.recipientKind) return false;
  if (b.kind === "asset" && b.assetMode === "specific" && !b.accountId) return false;
  if (b.kind === "asset" && !b.assetMode) return false;
  if (b.kind === "liability" && !b.liabilityId) return false;
  if (b.recipientKind !== "spouse" && !b.recipientId) return false;
  return true;
}

/**
 * Encodes (kind,id,assetMode) into a single <option value> so the
 * select element can carry the full disambiguator. Decoded by parseAssetOption.
 */
function encodeAsset(o: AssetOption): string {
  if (o.kind === "asset") {
    return `asset:${o.assetMode ?? "specific"}:${o.id ?? ""}`;
  }
  return `liability::${o.id ?? ""}`;
}
function findEncodedAsset(b: WizardBequest, opts: AssetOption[]): string {
  if (!b.kind) return "";
  if (b.kind === "asset" && b.assetMode === "all_assets") return "asset:all_assets:";
  if (b.kind === "asset" && b.accountId) return `asset:specific:${b.accountId}`;
  if (b.kind === "liability" && b.liabilityId) return `liability::${b.liabilityId}`;
  // Fall through — match the first option that aligns with whatever was set.
  const firstAsset = opts.find((o) => o.kind === b.kind);
  return firstAsset ? encodeAsset(firstAsset) : "";
}
function applyAssetSelection(
  b: WizardBequest,
  encoded: string,
): WizardBequest {
  if (!encoded) {
    return { ...b, kind: undefined, assetMode: undefined, accountId: null, liabilityId: null };
  }
  const [kind, mode, id] = encoded.split(":");
  if (kind === "asset") {
    return {
      ...b,
      kind: "asset",
      assetMode: (mode || "specific") as WillAssetMode,
      accountId: id || null,
      liabilityId: null,
    };
  }
  return {
    ...b,
    kind: "liability",
    assetMode: undefined,
    accountId: null,
    liabilityId: id || null,
  };
}

function encodeRecipient(o: RecipientOption): string {
  return `${o.kind}:${o.id ?? ""}`;
}
function findEncodedRecipient(b: WizardBequest): string {
  if (!b.recipientKind) return "";
  return `${b.recipientKind}:${b.recipientId ?? ""}`;
}
function applyRecipientSelection(
  b: WizardBequest,
  encoded: string,
): WizardBequest {
  if (!encoded) {
    return { ...b, recipientKind: undefined, recipientId: null };
  }
  const [kind, id] = encoded.split(":");
  return {
    ...b,
    recipientKind: kind as WillRecipientKind,
    recipientId: id || null,
  };
}

export default function WillBequestMapper({
  bequest,
  recipientOptions,
  assetOptions,
  onChange,
  onDiscard,
  onUndiscard,
}: WillBequestMapperProps) {
  const resolved = isBequestResolved(bequest);
  const containerTone = bequest.discarded
    ? "border-gray-700 bg-gray-900/30 opacity-50"
    : resolved
      ? "border-gray-700 bg-gray-900"
      : "border-amber-700/40 bg-amber-900/10";

  return (
    <div className={`rounded-md border p-3 ${containerTone}`}>
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 text-xs text-ink-3">
          <div>
            <span className="text-ink-4">Asset hint:</span>{" "}
            <span className="text-ink-2">{bequest.assetDescriptionHint || "—"}</span>
          </div>
          <div>
            <span className="text-ink-4">Recipient hint:</span>{" "}
            <span className="text-ink-2">{bequest.recipientNameHint || "—"}</span>
          </div>
        </div>
        {bequest.discarded ? (
          <button
            onClick={onUndiscard}
            className="text-xs text-accent underline hover:text-accent-ink"
          >
            Restore
          </button>
        ) : (
          <button
            onClick={onDiscard}
            className="text-xs text-gray-400 underline hover:text-red-400"
          >
            Discard
          </button>
        )}
      </div>

      {bequest.discarded ? null : (
        <div className="grid grid-cols-4 gap-2">
          <div className="col-span-2">
            <label className="mb-1 block text-xs text-gray-300">Asset</label>
            <select
              value={findEncodedAsset(bequest, assetOptions)}
              onChange={(e) => onChange(applyAssetSelection(bequest, e.target.value))}
              className={bequest.kind ? SELECT_CLASS : SELECT_EMPTY}
            >
              <option value="">Select asset…</option>
              {assetOptions.map((o) => (
                <option key={encodeAsset(o)} value={encodeAsset(o)}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-2">
            <label className="mb-1 block text-xs text-gray-300">Recipient</label>
            <select
              value={findEncodedRecipient(bequest)}
              onChange={(e) =>
                onChange(applyRecipientSelection(bequest, e.target.value))
              }
              className={bequest.recipientKind ? SELECT_CLASS : SELECT_EMPTY}
            >
              <option value="">Select recipient…</option>
              {recipientOptions.map((o) => (
                <option key={encodeRecipient(o)} value={encodeRecipient(o)}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-300">Percentage</label>
            <input
              type="number"
              min={0}
              max={100}
              step="0.01"
              value={bequest.percentage}
              onChange={(e) =>
                onChange({ ...bequest, percentage: Number(e.target.value || 0) })
              }
              className={INPUT_CLASS}
            />
          </div>
          <div className="col-span-2">
            <label className="mb-1 block text-xs text-gray-300">Condition</label>
            <select
              value={bequest.condition ?? "always"}
              onChange={(e) =>
                onChange({ ...bequest, condition: e.target.value as WillCondition })
              }
              className={SELECT_CLASS}
            >
              {CONDITION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-300">Display name</label>
            <input
              value={bequest.name ?? ""}
              onChange={(e) =>
                onChange({ ...bequest, name: e.target.value || undefined })
              }
              className={INPUT_CLASS}
              placeholder={bequest.assetDescriptionHint}
            />
          </div>
          <div className="flex items-end justify-end">
            {!resolved && (
              <span
                className="text-xs text-amber-400"
                title="Asset, recipient, and any required FKs must be filled in before commit."
              >
                ⚠ Incomplete
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Maps an ExtractedWillBequest from extraction into the wizard-internal
 * shape with sensible defaults. Used by the wizard when seeding state.
 */
export function seedWizardBequest(b: ExtractedWillBequest): WizardBequest {
  return {
    recipientNameHint: b.recipientNameHint,
    assetDescriptionHint: b.assetDescriptionHint,
    percentage: b.percentage,
    name: b.assetDescriptionHint || undefined,
    condition: "always",
  };
}
