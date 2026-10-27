"use client";

// The estate dialog's navigation rail. One destination per thing the advisor
// can open: the household overview, a row for every trust (revocable living
// trusts included), the planned-gift list, and a row for every charity — base
// plan and scenario-added alike. The old dialog listed base-plan trusts as dead
// text with no way in, and never listed base revocable trusts at all.

import type { ReactNode } from "react";
import type { RevocableTrustRow } from "@/lib/solver/revocable-trust-rows";
import { focusRing } from "./guided-trust-ui";

/**
 * Which pane the detail side is showing. `{ kind: "trust", id: null }` is the
 * new-trust wizard.
 *
 * `confirmingRemoval` and `addingFunding` ride on the selection rather than
 * sitting in their own state: each IS a pane, so navigating anywhere else drops
 * it with no clearing logic for a caller to forget.
 */
export type EstatePane =
  | { kind: "overview" }
  | { kind: "gifts" }
  | { kind: "trust"; id: string | null; confirmingRemoval?: boolean; addingFunding?: boolean }
  | { kind: "revocable"; name: string }
  | { kind: "charity"; id: string | null; confirmingRemoval?: boolean };

export interface RailTrust {
  id: string;
  name: string;
  /** "SLAT", "ILIT", "Irrevocable"… (`trustTypeLabel`). */
  label: string;
  /** The base plan already holds this trust; it is not a scenario addition. */
  isBase: boolean;
}

/** A revocable living trust: an account tag, not an entity, so keyed by name. */
export type RailRevocableTrust = Pick<RevocableTrustRow, "name" | "isBase">;

export interface RailCharity {
  id: string;
  name: string;
  charityType: "public" | "private";
  isBase: boolean;
}

/** One line of the trust list, entity or revocable — shared by the rail and the
 *  overview so both list the same trusts in the same order. */
export interface TrustListRow {
  key: string;
  name: string;
  label: string;
  isBase: boolean;
  pane: EstatePane;
}

export function trustListRows(trusts: RailTrust[], revocable: RailRevocableTrust[]): TrustListRow[] {
  return [
    ...trusts.map((t) => ({
      key: `trust:${t.id}`,
      name: t.name,
      label: t.label,
      isBase: t.isBase,
      pane: { kind: "trust", id: t.id } as const,
    })),
    ...revocable.map((r) => ({
      key: `revocable:${r.name}`,
      name: r.name,
      label: "Revocable",
      isBase: r.isBase,
      pane: { kind: "revocable", name: r.name } as const,
    })),
  ].sort((a, b) => a.name.localeCompare(b.name));
}

/** Rail identity of a pane — what the highlight compares. Deliberately blind to
 *  `confirmingRemoval` / `addingFunding`, so the trust stays selected under them. */
function paneKey(p: EstatePane): string {
  switch (p.kind) {
    case "trust":
    case "charity":
      return `${p.kind}:${p.id ?? "new"}`;
    case "revocable":
      return `revocable:${p.name}`;
    default:
      return p.kind;
  }
}

const ROW = `flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2.5 py-1.5 text-left text-[13px] transition-colors ${focusRing}`;

function rowCls(active: boolean): string {
  return `${ROW} ${
    active ? "bg-card-2 text-ink" : "text-ink-2 hover:bg-card-2/60 hover:text-ink"
  }`;
}

/** Origin chip: where the row came from, or that it isn't made yet. */
function Chip({ kind }: { kind: "base" | "added" | "draft" }) {
  return (
    <span
      className={`shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
        kind === "base"
          ? "border border-hair-2 bg-card text-ink-3"
          : kind === "added"
            ? "bg-accent/15 text-accent"
            : "border border-dashed border-hair-2 text-ink-3"
      }`}
    >
      {kind === "base" ? "Base" : kind === "added" ? "Added" : "Draft"}
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
        title={typeof detail === "string" ? `${label} · ${detail}` : label}
        className={rowCls(active)}
      >
        <span className="min-w-0 truncate">{label}</span>
        {detail ? <span className="shrink-0 text-ink-4">· {detail}</span> : null}
        <span className="flex-1" />
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
      className={`shrink-0 rounded-[var(--radius-sm)] border border-dashed border-hair-2 px-1.5 text-[13px] leading-5 text-ink-3 transition-colors hover:border-accent/60 hover:text-ink ${focusRing}`}
    >
      +
    </button>
  );
}

interface Props {
  trusts: RailTrust[];
  revocableTrusts: RailRevocableTrust[];
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
  revocableTrusts,
  charities,
  giftCount,
  selection,
  onSelect,
  onAddGift,
}: Props) {
  const active = paneKey(selection);
  const is = (p: EstatePane) => active === paneKey(p);
  const rows = trustListRows(trusts, revocableTrusts);
  const drafting = is({ kind: "trust", id: null });
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
        <GroupHeader title="Trusts" />
        <button
          type="button"
          onClick={() => onSelect({ kind: "trust", id: null })}
          className={`mb-1 flex w-full items-center justify-center gap-1.5 rounded-[var(--radius-sm)] bg-accent px-2.5 py-1.5 text-[13px] font-medium text-accent-on transition-colors hover:bg-accent-ink ${focusRing}`}
        >
          <span aria-hidden="true">＋</span>
          New trust
        </button>
        {rows.length === 0 && !drafting ? (
          <EmptyGroup>No trusts yet</EmptyGroup>
        ) : (
          <ul className="space-y-0.5">
            {drafting ? (
              <RailRow
                label="New trust…"
                badge={<Chip kind="draft" />}
                active
                onClick={() => onSelect({ kind: "trust", id: null })}
              />
            ) : null}
            {rows.map((r) => (
              <RailRow
                key={r.key}
                label={r.name}
                detail={r.label}
                badge={<Chip kind={r.isBase ? "base" : "added"} />}
                active={is(r.pane)}
                onClick={() => onSelect(r.pane)}
              />
            ))}
          </ul>
        )}
      </div>

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
                badge={<Chip kind={c.isBase ? "base" : "added"} />}
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
