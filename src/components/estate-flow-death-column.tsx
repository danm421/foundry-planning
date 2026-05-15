"use client";

import { useMemo } from "react";
import type { ProjectionResult } from "@/engine/projection";
import {
  type DeathSectionData,
  type RecipientGroup,
  type ConflictEntry,
} from "@/lib/estate/transfer-report";

// ── Currency formatter (matches estate-transfer-recipient-card.tsx) ───────────

const fmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

// ── Conflicts callout (mirrors EstateTransferConflictsCallout) ────────────────

function DeathColumnConflictsCallout({ conflicts }: { conflicts: ConflictEntry[] }) {
  if (conflicts.length === 0) return null;
  return (
    <section className="rounded-lg border border-amber-900/40 bg-amber-950/20 px-4 py-3">
      <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-200">
        Conflicts &amp; Overrides
      </h3>
      <p className="mb-2.5 text-[10px] text-amber-200/80">
        These assets have configuration that disagrees with how they transfer.
      </p>
      <ul className="space-y-1.5">
        {conflicts.map((c) => (
          <li
            key={c.id}
            className="rounded border border-amber-900/30 bg-amber-950/10 px-2.5 py-1.5 text-xs text-amber-100/90"
          >
            <div className="font-medium text-amber-100">{c.accountLabel}</div>
            <div className="mt-0.5 text-[10px] text-amber-200/70">
              Routes to <strong>{c.governingRecipient}</strong> via {c.governingMechanism}.
            </div>
            <ul className="mt-1 space-y-0.5">
              {c.overriddenBy.map((o, i) => (
                <li key={i} className="text-[10px] text-amber-200/90">
                  ▸ {o.note}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ── Death warnings callout ────────────────────────────────────────────────────

function DeathWarningsCallout({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null;
  return (
    <section className="rounded-lg border border-yellow-900/40 bg-yellow-950/20 px-4 py-3">
      <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-yellow-200">
        Engine Warnings
      </h3>
      <ul className="space-y-0.5">
        {warnings.map((w, i) => (
          <li key={i} className="text-[10px] text-yellow-200/80">
            ▸ {w}
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

// ── Recipient group — direct render with clickable asset rows ─────────────────
// EstateTransferRecipientCard does not accept a row-click callback, so we
// render recipient groups directly here, matching the card's dark-theme
// visual language while adding per-asset-row <button>s.

function ClickableRecipientGroup({
  group,
  onAssetClick,
}: {
  group: RecipientGroup;
  onAssetClick: (accountId: string) => void;
}) {
  const isSpouse = group.recipientKind === "spouse";
  const isSystemDefault = group.recipientKind === "system_default";

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

      {/* Mechanisms + asset rows */}
      <div className="mt-1.5 space-y-1.5">
        {group.byMechanism.map((mech) => (
          <div key={mech.mechanism}>
            {/* Mechanism header */}
            <div className="flex items-baseline justify-between gap-3 border-b border-gray-800/40 pb-0.5 text-[10px] uppercase tracking-wider text-gray-400">
              <span>{mech.mechanismLabel}</span>
              <span className="tabular-nums">{fmt.format(mech.total)}</span>
            </div>
            {/* Asset rows — each is a clickable button */}
            <div>
              {mech.assets.map((a, i) => {
                const accountId = a.sourceAccountId ?? null;
                return (
                  <button
                    key={`${a.sourceAccountId ?? a.sourceLiabilityId ?? "asset"}-${i}`}
                    type="button"
                    disabled={accountId == null}
                    aria-label={`${a.label} — ${fmt.format(a.amount)}`}
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
                      {a.conflictIds.length > 0 && (
                        <span
                          className="rounded bg-amber-900/40 px-1 py-0.5 text-[9px] font-medium uppercase tracking-wider text-amber-200"
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
          </div>
        ))}
      </div>

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
}

export function EstateFlowDeathColumn({
  section,
  deathOrder,
  projection,
  onAssetClick,
}: EstateFlowDeathColumnProps) {
  // Resolve death warnings from the projection year matching this section.
  const deathWarnings: string[] = useMemo(() => {
    if (!section) return [];
    const yearRow = projection.years.find((y) => y.year === section.year);
    return yearRow?.deathWarnings ?? [];
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

      {/* Warnings at top of column */}
      {deathWarnings.length > 0 && (
        <DeathWarningsCallout warnings={deathWarnings} />
      )}
      {section.conflicts.length > 0 && (
        <DeathColumnConflictsCallout conflicts={section.conflicts} />
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
            />
          ))}
        </div>
      )}
    </div>
  );
}
