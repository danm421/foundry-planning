"use client";

import { useMemo, useState } from "react";
import type { ProjectionResult } from "@/engine/projection";
import {
  estateAtDeathOf,
  netToRecipientsOf,
  type DeathSectionData,
  type MechanismBreakdown,
  type RecipientGroup,
} from "@/lib/estate/transfer-report";
import type { EstateFlowGift } from "@/lib/estate/estate-flow-gifts";
import { EstateTransferConflictsCallout } from "@/components/estate-transfer-conflicts-callout";
import { EstateFlowDeathTaxBox } from "@/components/estate-flow-death-tax-box";
import { DisclosureButton } from "@/components/disclosure-button";
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

const DISTRIBUTION_FORM_CHIP = {
  outright: { className: "bg-card-active text-ink-3", label: "Outright" },
  in_trust: { className: "bg-indigo-900/40 text-indigo-200", label: "In trust" },
} as const;

// ── Mechanism labels ──────────────────────────────────────────────────────────
// Asset rows are listed flat under each recipient (no per-mechanism subsections);
// each row's "Passes by" cell names how the asset passes. Short forms of the
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

// ── Recipient boxes ───────────────────────────────────────────────────────────
// Read-only: every edit starts from the ownership column's asset dialog. One
// collapsed box per recipient — name and what they receive. Expanding it lists
// their inherited assets inline (asset · how it passes · value), then any
// planned lifetime gifts and the recipient's reductions.

function RecipientBox({
  group,
  gifts,
  accountNameById,
}: {
  group: RecipientGroup;
  gifts: EstateFlowGift[];
  accountNameById: Map<string, string>;
}) {
  const [open, setOpen] = useState(false);
  const isSpouse = group.recipientKind === "spouse";
  const isSystemDefault = group.recipientKind === "system_default";

  // Inter-vivos gifts this recipient receives during life. A pure annotation —
  // deliberately NOT added into group.total / group.netTotal.
  const matchedGifts = gifts.filter((g) => giftMatchesGroup(g, group));

  // Sum every drain kind generically so a new DrainKind can never silently
  // drop out of the displayed reductions (and break gross − reductions = net).
  const totalDrains = Object.values(group.drainsByKind).reduce((s, v) => s + v, 0);
  const hasReductions = Math.abs(totalDrains) >= 0.5;

  // All mechanisms (titling, default order, beneficiary designation, …) are
  // combined into one list; the "Passes by" cell names each row's mechanism.
  const rows = group.byMechanism.flatMap((mech) =>
    mech.assets.map((asset) => ({
      asset,
      mechanismLabel: SHORT_MECHANISM_LABELS[mech.mechanism] ?? mech.mechanismLabel,
      mechanismTitle: mech.mechanismLabel,
    })),
  );

  const tint = isSpouse
    ? "bg-indigo-950/15"
    : isSystemDefault
      ? "bg-amber-950/15"
      : "";

  return (
    <li className={`overflow-hidden rounded border border-hair text-xs ${tint}`}>
      <DisclosureButton open={open} onToggle={() => setOpen((o) => !o)}>
        <span className="min-w-0 flex-1 truncate font-semibold text-ink" title={group.recipientLabel}>
          {group.recipientLabel}
        </span>
        {isSystemDefault && (
          <span className="shrink-0 rounded bg-amber-900/40 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-amber-200">
            No plan
          </span>
        )}
        <span className="shrink-0 whitespace-nowrap">
          {hasReductions && (
            <span className="mr-1.5 text-[10px] uppercase tracking-wider text-ink-4">Net</span>
          )}
          <span className="tabular-nums font-semibold text-ink">{fmt.format(group.netTotal)}</span>
        </span>
      </DisclosureButton>

      {open && (
        // Auto layout: "Passes by" and "Value" shrink to their content and sit
        // together on the right; the asset name (w-full + max-w-0) takes the rest.
        <table className="w-full border-collapse border-t border-hair">
          <tbody>
            {rows.map(({ asset: a, mechanismLabel, mechanismTitle }, i) => (
              <tr key={`${a.sourceAccountId ?? a.sourceLiabilityId ?? "asset"}-${i}`}>
                <td className="w-full max-w-0 py-1 pl-6 text-ink-3">
                  <span className="flex min-w-0 items-baseline gap-1.5">
                    <span className="truncate" title={a.label}>
                      {a.label}
                    </span>
                    {a.conflictIds.length > 0 && (
                      <span
                        className="shrink-0 rounded bg-amber-900/40 px-1 py-0.5 text-[9px] font-medium uppercase tracking-wider text-amber-200"
                        title={`${a.conflictIds.length} configuration conflict(s) on this asset`}
                      >
                        Conflict
                      </span>
                    )}
                    {a.distributionForm && (
                      <span
                        className={`shrink-0 rounded ${DISTRIBUTION_FORM_CHIP[a.distributionForm].className} px-1 py-0.5 text-[9px] font-medium uppercase tracking-wider`}
                      >
                        {DISTRIBUTION_FORM_CHIP[a.distributionForm].label}
                      </span>
                    )}
                  </span>
                </td>
                <td
                  className="whitespace-nowrap py-1 pl-3 text-right text-ink-4"
                  title={`Passes by ${mechanismTitle}`}
                >
                  {mechanismLabel}
                </td>
                <td className="whitespace-nowrap py-1 pl-3 pr-2 text-right tabular-nums text-ink-2">
                  {fmt.format(a.amount)}
                </td>
              </tr>
            ))}

            {matchedGifts.map((gift) => {
              const { label, year } = giftMarkerLabel(gift, accountNameById);
              return (
                <tr key={gift.id}>
                  <td colSpan={3} className="max-w-0 truncate py-1 pl-6 text-[11px] text-amber-400/90">
                    Also receives: {label} · {year}
                  </td>
                </tr>
              );
            })}

            {hasReductions && (
              <tr className="border-t border-hair">
                <td colSpan={2} className="py-1 pl-6 text-[11px] text-ink-3">
                  Reductions
                </td>
                <td className="whitespace-nowrap py-1 pr-2 text-right text-[11px] tabular-nums text-rose-300/80">
                  −{fmt.format(totalDrains)}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </li>
  );
}

// ── Totals strip ──────────────────────────────────────────────────────────────

function TotalsStrip({ section }: { section: DeathSectionData }) {
  // Taxes live in the tax box at the foot of the column; the strip's gap
  // between gross and net also carries debts paid, so it shows no tax figure.
  const gross = estateAtDeathOf(section);
  const net = netToRecipientsOf(section);

  return (
    <div className="flex items-baseline justify-between gap-3 rounded border border-hair bg-card-2 px-3 py-1.5 text-[10px] tabular-nums">
      <span className="text-ink-3">
        Gross <span className="text-ink-2">{fmt.format(gross)}</span>
      </span>
      <span className="font-semibold text-ink">
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
  /** Working gift drafts — matched per recipient group to render lifetime-gift markers. */
  gifts: EstateFlowGift[];
  /** Account display names keyed by id — resolves asset-gift marker labels. */
  accountNameById: Map<string, string>;
  /** Married households port the first death's unused exemption (DSUE). */
  isMarried: boolean;
}

export function EstateFlowDeathColumn({
  section,
  deathOrder,
  projection,
  gifts,
  accountNameById,
  isMarried,
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
      <div className="flex h-full items-center justify-center text-center text-xs text-ink-4">
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
          <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-ink-4">
            {deathLabel}
          </span>
          <span className="text-xs font-semibold tabular-nums text-ink-3">
            {section.year}
          </span>
        </div>
        {/* Gross / net strip */}
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
        <p className="text-xs text-ink-4">No transfers in this death event.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {section.recipients.map((group) => (
            <RecipientBox
              key={group.key}
              group={group}
              gifts={gifts}
              accountNameById={accountNameById}
            />
          ))}
        </ul>
      )}

      <EstateFlowDeathTaxBox
        tax={section.estateTax}
        showDsueGenerated={isMarried && section.estateTax.deathOrder === 1}
      />
    </div>
  );
}
