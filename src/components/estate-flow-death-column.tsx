"use client";

import { useMemo } from "react";
import type { ProjectionResult } from "@/engine/projection";
import {
  type DeathSectionData,
  type MechanismBreakdown,
  type RecipientGroup,
} from "@/lib/estate/transfer-report";
import type { EstateFlowGift } from "@/lib/estate/estate-flow-gifts";
import { EstateTransferConflictsCallout } from "@/components/estate-transfer-conflicts-callout";
import {
  summarizeDeathWarnings,
  type DeathWarningNote,
} from "@/lib/estate/death-warning-summary";

// ── Currency formatter (matches estate-transfer-recipient-card.tsx) ───────────

const fmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

// ── Estate planning notes callout ─────────────────────────────────────────────
// Advisor-facing translation of the engine's raw death-event warning codes
// (see lib/estate/death-warning-summary.ts).

function DeathWarningsCallout({ notes }: { notes: DeathWarningNote[] }) {
  if (notes.length === 0) return null;
  return (
    <section className="rounded-lg border border-yellow-900/40 bg-yellow-950/20 px-4 py-3">
      <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-yellow-200">
        Estate Planning Notes
      </h3>
      <ul className="space-y-1">
        {notes.map((note) => (
          <li key={note.key} className="text-[10px] text-yellow-200/80">
            ▸ {note.message}
            {note.items.length > 0 && (
              <ul className="mt-0.5 ml-3 space-y-0.5">
                {note.items.map((item, i) => (
                  <li key={i} className="text-yellow-200/60">
                    • {item}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

// ── Drain kinds (module-scoped to avoid per-render reallocation) ─────────────

const DRAIN_KINDS: ReadonlyArray<keyof RecipientGroup["drainsByKind"]> = [
  "federal_estate_tax",
  "state_estate_tax",
  "admin_expenses",
  "debts_paid",
  "ird_tax",
];

// ── Mechanism tags ────────────────────────────────────────────────────────────
// Asset rows are listed flat under each recipient (no per-mechanism subsections);
// each row carries a compact tag naming how the asset passes. Short forms of the
// MECHANISM_LABELS in lib/estate/transfer-report.ts.

const SHORT_MECHANISM_LABELS: Partial<
  Record<MechanismBreakdown["mechanism"], string>
> = {
  titling: "Titling",
  beneficiary_designation: "Beneficiary",
  will: "Bequest",
  will_residuary: "Remainder",
  will_liability_bequest: "Will debt",
  fallback_spouse: "Default",
  fallback_children: "Default",
  fallback_other_heirs: "Default",
  unlinked_liability_proportional: "Unlinked debt",
  trust_pour_out: "Pour-out",
};

// ── Gift → recipient-group matching ──────────────────────────────────────────
// A gift matches a recipient group when the gift's recipient id equals the
// group's `recipientId` AND the gift's recipient kind equals the group's
// `recipientKind`. Gift recipient kinds (entity / family_member /
// external_beneficiary) are a subset of RecipientGroup.recipientKind, so the
// discriminators line up directly — no mapping table needed. `spouse` and
// `system_default` groups never carry a recipient id that gifts target.

function giftMatchesGroup(gift: EstateFlowGift, group: RecipientGroup): boolean {
  if (group.recipientId == null) return false;
  return (
    gift.recipient.kind === group.recipientKind &&
    gift.recipient.id === group.recipientId
  );
}

/**
 * Human-readable label for a planned-gift marker line, per gift kind:
 *  - cash-once → formatted dollar amount
 *  - series    → "$X/yr START–END"
 *  - asset-once → "P% of {account name}" (account name resolved via the map;
 *                 falls back to "an asset" when the id is not resolvable)
 */
function giftMarkerLabel(
  gift: EstateFlowGift,
  accountNameById: Map<string, string>,
): { label: string; year: number } {
  if (gift.kind === "cash-once") {
    return { label: fmt.format(gift.amount), year: gift.year };
  }
  if (gift.kind === "series") {
    return {
      label: `${fmt.format(gift.annualAmount)}/yr ${gift.startYear}–${gift.endYear}`,
      year: gift.startYear,
    };
  }
  const assetName = accountNameById.get(gift.accountId) ?? "an asset";
  return {
    label: `${Math.round(gift.percent * 100)}% of ${assetName}`,
    year: gift.year,
  };
}

// ── Planned lifetime gifts block ─────────────────────────────────────────────
// Inter-vivos gifts the recipient receives during life. Rendered as a separate
// annotation under the recipient's inherited-asset rows — it does NOT roll into
// the group's total / netTotal.

function PlannedGiftsBlock({
  gifts,
  accountNameById,
  onGiftClick,
}: {
  gifts: EstateFlowGift[];
  accountNameById: Map<string, string>;
  onGiftClick: (giftId: string) => void;
}) {
  if (gifts.length === 0) return null;
  return (
    <div className="mt-1.5 border-t border-amber-900/30 pt-1">
      <p className="text-[9px] font-medium uppercase tracking-[0.18em] text-amber-300/80">
        Planned lifetime gifts
      </p>
      <div className="mt-0.5">
        {gifts.map((gift) => {
          const { label, year } = giftMarkerLabel(gift, accountNameById);
          return (
            <button
              key={gift.id}
              type="button"
              onClick={() => onGiftClick(gift.id)}
              className="block w-full truncate rounded px-1 py-0.5 text-left text-[11px] text-amber-400/90 transition-colors hover:bg-amber-950/30 hover:text-amber-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-500"
            >
              Also receives: {label} · {year}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Recipient group — direct render with clickable asset rows ─────────────────
// EstateTransferRecipientCard does not accept a row-click callback, so we
// render recipient groups directly here, matching the card's dark-theme
// visual language while adding per-asset-row <button>s.

function ClickableRecipientGroup({
  group,
  onAssetClick,
  gifts,
  accountNameById,
  onGiftClick,
}: {
  group: RecipientGroup;
  onAssetClick: (accountId: string) => void;
  gifts: EstateFlowGift[];
  accountNameById: Map<string, string>;
  onGiftClick: (giftId: string) => void;
}) {
  const isSpouse = group.recipientKind === "spouse";
  const isSystemDefault = group.recipientKind === "system_default";

  // Inter-vivos gifts this recipient receives during life. A pure annotation —
  // deliberately NOT added into group.total / group.netTotal.
  const matchedGifts = gifts.filter((g) => giftMatchesGroup(g, group));

  const totalDrains = DRAIN_KINDS.reduce((s, k) => s + group.drainsByKind[k], 0);
  const hasReductions = Math.abs(totalDrains) >= 0.5;

  return (
    <section
      className={
        "rounded-lg border px-3 py-2.5 " +
        (isSpouse
          ? "border-indigo-900/40 bg-indigo-950/15"
          : isSystemDefault
            ? "border-amber-900/40 bg-amber-950/15"
            : "border-gray-800/80 bg-gray-900/50")
      }
    >
      {/* Recipient header */}
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="flex items-baseline gap-2 text-xs font-semibold text-gray-100">
          <span>{group.recipientLabel}</span>
          {isSystemDefault && (
            <span className="rounded bg-amber-900/40 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-amber-200">
              No plan
            </span>
          )}
        </h3>
        <div className="flex items-baseline gap-1.5">
          {hasReductions && (
            <span className="text-[10px] uppercase tracking-wider text-gray-500">
              Net
            </span>
          )}
          <span className="text-sm font-semibold tabular-nums text-gray-50">
            {fmt.format(group.netTotal)}
          </span>
        </div>
      </div>

      {/* Asset rows — flat list under the recipient. All mechanisms (titling,
          default order, beneficiary designation, …) are combined into one
          block; each row carries a compact tag naming its mechanism. */}
      <div className="mt-1.5">
        {group.byMechanism
          .flatMap((mech) =>
            mech.assets.map((asset) => ({
              asset,
              mechanismLabel:
                SHORT_MECHANISM_LABELS[mech.mechanism] ?? mech.mechanismLabel,
            })),
          )
          .map(({ asset: a, mechanismLabel }, i) => {
            const accountId = a.sourceAccountId ?? null;
            return (
              <button
                key={`${a.sourceAccountId ?? a.sourceLiabilityId ?? "asset"}-${i}`}
                type="button"
                disabled={accountId == null}
                aria-label={`${a.label} (${mechanismLabel}) — ${fmt.format(a.amount)}`}
                aria-disabled={accountId == null ? true : undefined}
                onClick={() => accountId != null && onAssetClick(accountId)}
                className={
                  "group flex w-full items-baseline justify-between gap-3 py-0.5 pl-2 text-left text-xs text-gray-300 " +
                  (accountId != null
                    ? "cursor-pointer hover:text-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-500"
                    : "cursor-default")
                }
              >
                <span className="flex items-baseline gap-1.5 truncate">
                  <span className="truncate">{a.label}</span>
                  <span className="shrink-0 rounded bg-gray-800/70 px-1 py-0.5 text-[9px] font-medium uppercase tracking-wider text-gray-400">
                    {mechanismLabel}
                  </span>
                  {a.conflictIds.length > 0 && (
                    <span
                      className="shrink-0 rounded bg-amber-900/40 px-1 py-0.5 text-[9px] font-medium uppercase tracking-wider text-amber-200"
                      title={`${a.conflictIds.length} configuration conflict(s) on this asset`}
                    >
                      Conflict
                    </span>
                  )}
                </span>
                <span className="tabular-nums text-gray-200">
                  {fmt.format(a.amount)}
                </span>
              </button>
            );
          })}
      </div>

      {/* Planned lifetime gifts — inter-vivos gifts to this recipient. Shown as
          a separate amber annotation; does not affect the group total. */}
      <PlannedGiftsBlock
        gifts={matchedGifts}
        accountNameById={accountNameById}
        onGiftClick={onGiftClick}
      />

      {/* Reductions footer */}
      {hasReductions && (
        <div className="mt-1.5 flex items-baseline justify-between gap-2 border-t border-gray-800/60 pt-1 text-[10px] text-gray-400">
          <span>
            Gross {fmt.format(group.total)}{" "}
            <span className="text-rose-300/80">
              − reductions {fmt.format(totalDrains)}
            </span>
          </span>
          <span className="tabular-nums text-gray-300">{fmt.format(group.netTotal)}</span>
        </div>
      )}
    </section>
  );
}

// ── Totals strip ──────────────────────────────────────────────────────────────

function TotalsStrip({ section }: { section: DeathSectionData }) {
  const gross = section.assetEstateValue + section.reconciliation.sumLiabilityTransfers;
  const tax = section.reconciliation.sumReductions;
  const net = section.reconciliation.sumRecipients;

  return (
    <div className="flex items-baseline justify-between gap-3 rounded border border-gray-800/50 bg-gray-900/40 px-3 py-1.5 text-[10px] tabular-nums">
      <span className="text-gray-400">
        Gross <span className="text-gray-200">{fmt.format(gross)}</span>
      </span>
      {tax > 0 && (
        <span className="text-rose-400/80">
          − {fmt.format(tax)} taxes
        </span>
      )}
      <span className="font-semibold text-gray-100">
        Net {fmt.format(net)}
      </span>
    </div>
  );
}

// ── EstateFlowDeathColumn ─────────────────────────────────────────────────────

interface EstateFlowDeathColumnProps {
  /** Pre-built section data from the view-level useMemo — null when no event falls in the plan window. */
  section: DeathSectionData | null;
  /** Which ordinal death this column represents — used for empty-state messaging only. */
  deathOrder: 1 | 2;
  /** Full projection — needed for the deathWarnings lookup. */
  projection: ProjectionResult;
  onAssetClick: (accountId: string) => void;
  /** Working gift drafts — matched per recipient group to render lifetime-gift markers. */
  gifts: EstateFlowGift[];
  /** Account display names keyed by id — resolves asset-gift marker labels. */
  accountNameById: Map<string, string>;
  /** Opens the gift edit dialog seeded with the clicked gift. */
  onGiftClick: (giftId: string) => void;
}

export function EstateFlowDeathColumn({
  section,
  deathOrder,
  projection,
  onAssetClick,
  gifts,
  accountNameById,
  onGiftClick,
}: EstateFlowDeathColumnProps) {
  // Resolve death warnings from the projection year matching this section,
  // then translate the raw engine codes into advisor-facing notes. Asset names
  // come from the section's own transfer rows (post-death account labels).
  const notes: DeathWarningNote[] = useMemo(() => {
    if (!section) return [];
    const yearRow = projection.years.find((y) => y.year === section.year);
    const rawWarnings = yearRow?.deathWarnings ?? [];
    if (rawWarnings.length === 0) return [];

    const nameById = new Map<string, string>();
    for (const group of section.recipients) {
      for (const mech of group.byMechanism) {
        for (const a of mech.assets) {
          if (a.sourceAccountId) nameById.set(a.sourceAccountId, a.label);
        }
      }
    }
    return summarizeDeathWarnings(rawWarnings, nameById);
  }, [section, projection.years]);

  // ── No data ───────────────────────────────────────────────────────────────

  if (!section) {
    return (
      <div className="flex h-full items-center justify-center text-center text-xs text-gray-600">
        {deathOrder === 2
          ? "No second death projected in plan window."
          : "No death event projected in plan window."}
      </div>
    );
  }

  // ── Column heading ────────────────────────────────────────────────────────

  const deathLabel =
    deathOrder === 1
      ? `${section.decedentName} — First to die`
      : `${section.decedentName} — Second to die`;

  return (
    <div className="flex flex-col gap-3">
      {/* Column header */}
      <div>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-gray-500">
            {deathLabel}
          </span>
          <span className="text-xs font-semibold tabular-nums text-gray-300">
            {section.year}
          </span>
        </div>
        {/* Gross / tax / net strip */}
        <div className="mt-2">
          <TotalsStrip section={section} />
        </div>
      </div>

      {/* Estate planning notes at top of column */}
      {notes.length > 0 && <DeathWarningsCallout notes={notes} />}
      {section.conflicts.length > 0 && (
        <EstateTransferConflictsCallout conflicts={section.conflicts} />
      )}

      {/* Recipient groups */}
      {section.recipients.length === 0 ? (
        <p className="text-xs text-gray-500">No transfers in this death event.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {section.recipients.map((group) => (
            <ClickableRecipientGroup
              key={group.key}
              group={group}
              onAssetClick={onAssetClick}
              gifts={gifts}
              accountNameById={accountNameById}
              onGiftClick={onGiftClick}
            />
          ))}
        </div>
      )}
    </div>
  );
}
