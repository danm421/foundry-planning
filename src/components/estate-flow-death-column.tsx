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
import { ShareBandButton } from "@/components/estate-flow-share-band";
import { AlertCircleIcon, GiftIcon } from "@/components/icons";
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

// Outright is the usual case, so it stays plain; In trust takes the entity hue.
const DISTRIBUTION_FORM_TAG = {
  outright: { className: "text-ink-4", label: "Outright" },
  in_trust: {
    className:
      "rounded-full bg-[color-mix(in_srgb,var(--share-entity)_16%,transparent)] px-1.5 font-semibold text-[var(--share-entity)]",
    label: "In trust",
  },
} as const;

/** Hue per kind of recipient: the share band, its edge and the percent. */
const SHARE_HUE: Record<RecipientGroup["recipientKind"], string> = {
  spouse: "var(--share-spouse)",
  family_member: "var(--share-family)",
  entity: "var(--share-entity)",
  external_beneficiary: "var(--share-external)",
  system_default: "var(--share-no-plan)",
};

/** Debts carry a true minus sign, matching the reductions line. */
function signed(n: number): string {
  return n < 0 ? `−${fmt.format(-n)}` : fmt.format(n);
}

// ── Mechanism labels ──────────────────────────────────────────────────────────
// Asset rows are listed flat under each recipient (no per-mechanism subsections);
// the first row of each run that passes the same way names how. Short forms of
// the MECHANISM_LABELS in lib/estate/transfer-report.ts.

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
 * A planned lifetime gift in words, per gift kind:
 *  - cash-once  → "$50,000 in 2026"
 *  - series     → "$19,000 a year, 2026–2035"
 *  - asset-once → "15% of {account name} in 2030" (falls back to "an asset"
 *                 when the account id is not resolvable)
 */
function giftText(gift: EstateFlowGift, accountNameById: Map<string, string>): string {
  if (gift.kind === "cash-once") {
    return `${fmt.format(gift.amount)} in ${gift.year}`;
  }
  if (gift.kind === "series") {
    return `${fmt.format(gift.annualAmount)} a year, ${gift.startYear}–${gift.endYear}`;
  }
  const assetName = accountNameById.get(gift.accountId) ?? "an asset";
  return `${Math.round(gift.percent * 100)}% of ${assetName} in ${gift.year}`;
}

function NoPlanFlag() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-warn/15 py-px pl-1 pr-1.5 text-[11px] font-semibold text-warn">
      <AlertCircleIcon width={11} height={11} strokeWidth={2.2} aria-hidden="true" />
      No plan
    </span>
  );
}

// ── Recipient boxes ───────────────────────────────────────────────────────────
// Read-only: every edit starts from the ownership column's asset dialog. One
// box per recipient, its header banded to their share of what passes at this
// death. Expanding it lists their inherited assets (accounts with no balance
// fold into one line), then any planned lifetime gifts and what taxes,
// expenses and debts took.

function RecipientBox({
  group,
  share,
  gifts,
  accountNameById,
}: {
  group: RecipientGroup;
  /** This recipient's fraction of everything the column's recipients net. */
  share: number;
  gifts: EstateFlowGift[];
  accountNameById: Map<string, string>;
}) {
  const [open, setOpen] = useState(false);
  const [showEmpty, setShowEmpty] = useState(false);
  const isSystemDefault = group.recipientKind === "system_default";
  const hue = SHARE_HUE[group.recipientKind];

  // Inter-vivos gifts this recipient receives during life. A pure annotation —
  // deliberately NOT added into group.total / group.netTotal.
  const matchedGifts = gifts.filter((g) => giftMatchesGroup(g, group));

  // Sum every drain kind generically so a new DrainKind can never silently
  // drop out of the displayed reductions (and break gross − reductions = net).
  const totalDrains = Object.values(group.drainsByKind).reduce((s, v) => s + v, 0);
  const hasReductions = Math.abs(totalDrains) >= 0.5;

  // All mechanisms (titling, default order, beneficiary designation, …) are
  // combined into one list, in runs that pass the same way.
  const rows = group.byMechanism.flatMap((mech) =>
    mech.assets.map((asset, i) => ({
      key: `${mech.mechanism}-${asset.sourceAccountId ?? asset.sourceLiabilityId ?? "asset"}-${i}`,
      asset,
      mechanismLabel: SHORT_MECHANISM_LABELS[mech.mechanism] ?? mech.mechanismLabel,
      mechanismTitle: mech.mechanismLabel,
    })),
  );
  // Displays as $0 — folded until asked for.
  const isEmpty = (amount: number) => Math.abs(amount) < 0.5;
  const withBalance = rows.filter((r) => !isEmpty(r.asset.amount));
  const emptyCount = rows.length - withBalance.length;
  const shown = showEmpty ? rows : withBalance;

  return (
    <li
      className={`overflow-hidden rounded-lg border text-xs ${open ? "border-hair" : "border-transparent"}`}
    >
      <ShareBandButton
        open={open}
        onToggle={() => setOpen((o) => !o)}
        share={share}
        hue={hue}
        hatched={isSystemDefault}
        shareOf="the total"
        label={group.recipientLabel}
        figure={
          <>
            {hasReductions && (
              <span className="mr-1.5 text-[10.5px] font-normal text-ink-4">net</span>
            )}
            <span>{fmt.format(group.netTotal)}</span>
          </>
        }
        flag={isSystemDefault ? <NoPlanFlag /> : undefined}
      />

      {open && (
        <div className="pb-2.5 pl-[30px] pr-3 pt-1.5">
          <ul>
            {shown.map(({ key, asset: a, mechanismLabel, mechanismTitle }, i) => {
              const runStart = i === 0 || shown[i - 1].mechanismLabel !== mechanismLabel;
              return (
                <li
                  key={key}
                  className={`flex items-baseline gap-2.5 py-[3px] ${runStart && i > 0 ? "mt-1.5" : ""}`}
                >
                  <span className="flex min-w-0 flex-1 items-baseline gap-1.5 text-ink-2">
                    <span className="truncate" title={a.label}>
                      {a.label}
                    </span>
                    {a.conflictIds.length > 0 && (
                      <span
                        className="flex shrink-0 items-center gap-0.5 self-center text-[10.5px] font-semibold text-warn"
                        title={`${a.conflictIds.length} configuration conflict(s) on this asset`}
                      >
                        <AlertCircleIcon width={11} height={11} strokeWidth={2.2} aria-hidden="true" />
                        Conflict
                      </span>
                    )}
                    {a.distributionForm && (
                      <span
                        className={`shrink-0 text-[10.5px] ${DISTRIBUTION_FORM_TAG[a.distributionForm].className}`}
                      >
                        {DISTRIBUTION_FORM_TAG[a.distributionForm].label}
                      </span>
                    )}
                  </span>
                  {runStart && (
                    <span
                      className="shrink-0 whitespace-nowrap text-[11px] text-ink-4"
                      title={`Passes by ${mechanismTitle}`}
                    >
                      {mechanismLabel}
                    </span>
                  )}
                  <span
                    className={`shrink-0 whitespace-nowrap tabular-nums ${a.amount > 0 ? "text-ink-2" : "text-ink-4"}`}
                  >
                    {signed(a.amount)}
                  </span>
                </li>
              );
            })}
          </ul>

          {emptyCount > 0 && (
            <button
              type="button"
              onClick={() => setShowEmpty((s) => !s)}
              className="mt-1.5 rounded-sm py-0.5 text-[11.5px] text-ink-3 underline decoration-hair-2 underline-offset-[3px] hover:text-ink focus:outline-none focus-visible:ring-1 focus-visible:ring-hair-2"
            >
              {showEmpty
                ? "Hide accounts with no balance"
                : `${emptyCount} more account${emptyCount === 1 ? "" : "s"} with no balance`}
            </button>
          )}

          {matchedGifts.map((gift) => (
            <p key={gift.id} className="mt-2 flex items-center gap-1.5 text-[11.5px] text-ink-3">
              <GiftIcon
                width={13}
                height={13}
                aria-hidden="true"
                className="shrink-0"
                style={{ color: hue }}
              />
              <span className="min-w-0">Lifetime gift: {giftText(gift, accountNameById)}</span>
            </p>
          ))}

          {hasReductions && (
            <dl className="mt-2.5 grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 border-t border-dashed border-hair-2 pt-1.5 text-[11.5px] text-ink-3">
              <dt>Gross</dt>
              <dd className="text-right tabular-nums">{fmt.format(group.total)}</dd>
              <dt>Taxes, expenses and debts</dt>
              <dd className="text-right tabular-nums">{signed(-totalDrains)}</dd>
            </dl>
          )}
        </div>
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

  // Each band is a recipient's share of what the column's recipients net.
  const shareBase = section.recipients.reduce((s, g) => s + Math.max(0, g.netTotal), 0);

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
              share={shareBase > 0 ? Math.max(0, group.netTotal) / shareBase : 0}
              gifts={gifts}
              accountNameById={accountNameById}
            />
          ))}
        </ul>
      )}

      <EstateFlowDeathTaxBox
        tax={section.estateTax}
        estateAtDeath={estateAtDeathOf(section)}
        showDsueGenerated={isMarried && section.estateTax.deathOrder === 1}
      />
    </div>
  );
}
