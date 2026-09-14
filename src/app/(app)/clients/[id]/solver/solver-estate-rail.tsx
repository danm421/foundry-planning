"use client";

// The estate dialog's navigation rail. One destination per thing the advisor
// can open: the household overview, the planned-gift list, and a row for every
// trust and charity the working tree holds — base plan and scenario-added
// alike. The old dialog listed base-plan trusts as dead text with no way in.

import type { ReactNode } from "react";

/**
 * Which pane the detail side is showing. `id: null` is the add form.
 *
 * `confirmingRemoval` rides on the selection rather than sitting in its own
 * state: the confirmation IS a pane, so navigating anywhere else drops it with
 * no clearing logic for a caller to forget.
 */
export type EstatePane =
  | { kind: "overview" }
  | { kind: "gifts" }
  | { kind: "trust"; id: string | null; confirmingRemoval?: boolean }
  | { kind: "charity"; id: string | null };

export interface RailTrust {
  id: string;
  name: string;
  /** "ILIT", "IDGT"… — null when the entity records no subtype. */
  subType: string | null;
  /** The base plan already holds this trust; it is not a scenario addition. */
  isBase: boolean;
}

export interface RailCharity {
  id: string;
  name: string;
  charityType: "public" | "private";
  isBase: boolean;
}

/** Rail identity of a pane — what the highlight compares. Deliberately blind to
 *  `confirmingRemoval`, so the trust stays selected while its confirm is up. */
function paneKey(p: EstatePane): string {
  return p.kind === "trust" || p.kind === "charity" ? `${p.kind}:${p.id ?? "new"}` : p.kind;
}

const ROW =
  "flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2.5 py-1.5 text-left text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60";

function rowCls(active: boolean): string {
  return `${ROW} ${
    active ? "bg-card-2 text-ink" : "text-ink-2 hover:bg-card-2/60 hover:text-ink"
  }`;
}

/** Origin chip. Matches SolverTechniqueRow so one vocabulary covers the dialog
 *  and the technique list behind it. */
function OriginBadge({ isBase }: { isBase: boolean }) {
  return (
    <span
      className={`shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
        isBase ? "border border-hair-2 bg-card text-ink-3" : "bg-accent/15 text-accent"
      }`}
    >
      {isBase ? "Base plan" : "Added"}
    </span>
  );
}

function RailRow({
  label,
  detail,
  badge,
  active,
  onClick,
}: {
  label: string;
  detail?: ReactNode;
  badge?: ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        aria-current={active ? "true" : undefined}
        className={rowCls(active)}
      >
        <span className="min-w-0 flex-1 truncate">
          {label}
          {detail ? <span className="ml-1.5 text-ink-4">· {detail}</span> : null}
        </span>
        {badge}
      </button>
    </li>
  );
}

function GroupHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 px-2.5 pb-1 pt-1">
      <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink-3">
        {title}
      </span>
      {action}
    </div>
  );
}

/** Dashed "+" affordance on a group header. */
function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="shrink-0 rounded-[var(--radius-sm)] border border-dashed border-hair-2 px-1.5 text-[13px] leading-5 text-ink-3 transition-colors hover:border-accent/60 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
    >
      +
    </button>
  );
}

interface Props {
  trusts: RailTrust[];
  charities: RailCharity[];
  giftCount: number;
  selection: EstatePane;
  onSelect: (p: EstatePane) => void;
  /** The gift editor is a stacked dialog, not a pane, so adding one is an
   *  action rather than a destination. */
  onAddGift: () => void;
}

export function SolverEstateRail({
  trusts,
  charities,
  giftCount,
  selection,
  onSelect,
  onAddGift,
}: Props) {
  const active = paneKey(selection);
  const is = (p: EstatePane) => active === paneKey(p);
  return (
    <nav
      aria-label="Estate plan"
      className="flex h-full w-36 shrink-0 flex-col gap-3 overflow-y-auto border-r border-hair bg-card-2/40 px-2 py-3 sm:w-[13.5rem]"
    >
      <ul className="space-y-0.5">
        <RailRow
          label="Overview"
          active={is({ kind: "overview" })}
          onClick={() => onSelect({ kind: "overview" })}
        />
      </ul>

      <div>
        <GroupHeader
          title="Gifts"
          action={<AddButton label="Add gift" onClick={onAddGift} />}
        />
        <ul className="space-y-0.5">
          <RailRow
            label="Planned gifts"
            detail={giftCount > 0 ? <span className="tabular">{giftCount}</span> : null}
            active={is({ kind: "gifts" })}
            onClick={() => onSelect({ kind: "gifts" })}
          />
        </ul>
      </div>

      <div>
        <GroupHeader
          title="Trusts"
          action={
            <AddButton
              label="Add trust"
              onClick={() => onSelect({ kind: "trust", id: null })}
            />
          }
        />
        {trusts.length === 0 ? (
          <EmptyGroup>No trusts yet</EmptyGroup>
        ) : (
          <ul className="space-y-0.5">
            {trusts.map((t) => (
              <RailRow
                key={t.id}
                label={t.name}
                detail={t.subType}
                badge={<OriginBadge isBase={t.isBase} />}
                active={is({ kind: "trust", id: t.id })}
                onClick={() => onSelect({ kind: "trust", id: t.id })}
              />
            ))}
          </ul>
        )}
      </div>

      <div>
        <GroupHeader
          title="Charities"
          action={
            <AddButton
              label="Add charity"
              onClick={() => onSelect({ kind: "charity", id: null })}
            />
          }
        />
        {charities.length === 0 ? (
          <EmptyGroup>No charities yet</EmptyGroup>
        ) : (
          <ul className="space-y-0.5">
            {charities.map((c) => (
              <RailRow
                key={c.id}
                label={c.name}
                badge={<OriginBadge isBase={c.isBase} />}
                active={is({ kind: "charity", id: c.id })}
                onClick={() => onSelect({ kind: "charity", id: c.id })}
              />
            ))}
          </ul>
        )}
      </div>
    </nav>
  );
}

function EmptyGroup({ children }: { children: ReactNode }) {
  return <p className="px-2.5 py-1 text-[12px] text-ink-4">{children}</p>;
}
