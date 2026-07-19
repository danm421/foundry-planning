"use client";

import { useEffect, useRef, useState } from "react";
import {
  allowedDispositions,
  isSplittable,
  type DivisibleObject,
  type DivorceDisposition,
} from "@/lib/divorce/allocation-rules";
import { splitAmounts } from "@/lib/divorce/split-math";
import type { OnAllocate } from "./divorce-workbench";

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/** Turn a snake/camel subtype token into a readable label
 *  ("real_estate" → "Real estate", "education_savings" → "Education savings"). */
function humanize(s: string | null): string | null {
  if (!s) return null;
  const spaced = s.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

type CardSide = "primary" | "spouse" | "pool";

/** Which owner the object currently carries, phrased for the card's owner chip. */
function ownerLabel(
  obj: DivisibleObject,
  people: { primaryName: string; spouseName: string },
): string {
  switch (obj.ownerSide) {
    case "primary":
      return people.primaryName || "Primary";
    case "spouse":
      return people.spouseName || "Spouse";
    case "joint":
      return "Joint";
    case "entity":
      return "Entity";
    case "external":
      return "External";
    default:
      return "Unassigned";
  }
}

export interface DivisibleCardProps {
  obj: DivisibleObject;
  /** The object's resolved disposition (drives the checked menu item + share). */
  disposition: DivorceDisposition;
  splitPercentToSpouse: number | null;
  /** Which column this card sits in — decides which split share it shows. */
  side: CardSide;
  /** Shows the disposition menu. Only an object's "home" card is interactive;
   *  split reflections and duplicate ghosts on the spouse side are read-only. */
  interactive: boolean;
  /** The duplicate reflection on the spouse column — dashed + muted, no menu. */
  ghost?: boolean;
  /** Joint/external default not yet confirmed — amber chip, sits in the pool. */
  needsDecision?: boolean;
  /** Entity → its owned-account objects, rendered as indented static rows. */
  childObjects?: DivisibleObject[];
  people: { primaryName: string; spouseName: string };
  onAllocate: OnAllocate;
  /** Opens the split dialog for this object (menu picks "Split…"). */
  onOpenSplit: (obj: DivisibleObject) => void;
}

export function DivisibleCard({
  obj,
  disposition,
  splitPercentToSpouse,
  side,
  interactive,
  ghost,
  needsDecision,
  childObjects,
  people,
  onAllocate,
  onOpenSplit,
}: DivisibleCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const isFlow = obj.kind === "income" || obj.kind === "expense";
  const share =
    disposition === "split" && splitPercentToSpouse != null && side !== "pool"
      ? splitAmounts(obj.value, obj.basis, obj.rothValue, splitPercentToSpouse)
      : null;
  const figure = share
    ? side === "spouse"
      ? share.spouse.value
      : share.primary.value
    : isFlow
      ? obj.annualAmount
      : obj.value;
  const basisFigure = share
    ? side === "spouse"
      ? share.spouse.basis
      : share.primary.basis
    : obj.basis;

  const subtypeLabel = humanize(obj.subtype);
  const showBasis = isSplittable(obj);
  const spouseName = people.spouseName || "spouse";

  function choose(d: DivorceDisposition) {
    setMenuOpen(false);
    if (d === "split") {
      onOpenSplit(obj);
      return;
    }
    onAllocate(obj.kind, obj.id, d, null);
  }

  function dispositionLabel(d: DivorceDisposition): string {
    switch (d) {
      case "primary":
        return `To ${people.primaryName || "primary"}`;
      case "spouse":
        return `To ${people.spouseName || "spouse"}`;
      case "split":
        return "Split…";
      case "duplicate":
        return "Duplicate to both";
    }
  }

  const surface = ghost
    ? "border border-dashed border-hair-2 bg-transparent"
    : "border border-hair bg-card";

  return (
    <div className={`rounded-[var(--radius)] p-3 ${surface}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div
            className={`truncate text-[13px] font-medium ${ghost ? "text-ink-3" : "text-ink"}`}
          >
            {obj.label}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {subtypeLabel ? (
              <span className="text-[11px] text-ink-3">{subtypeLabel}</span>
            ) : null}
            <span className="chip px-2 py-0.5 text-[10px]">{ownerLabel(obj, people)}</span>
            {needsDecision ? (
              <span
                className="chip px-2 py-0.5 text-[10px]"
                style={{
                  color: "var(--color-warn)",
                  borderColor: "color-mix(in oklab, var(--color-warn) 45%, transparent)",
                  background: "color-mix(in oklab, var(--color-warn) 10%, transparent)",
                }}
              >
                Needs decision
              </span>
            ) : null}
            {ghost ? (
              <span className="chip px-2 py-0.5 text-[10px]">Duplicate</span>
            ) : null}
          </div>
        </div>

        {interactive ? (
          <div className="relative shrink-0" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label={`Change allocation for ${obj.label}`}
              className="flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] text-ink-3 hover:bg-card-hover hover:text-ink"
            >
              <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
                <circle cx="4" cy="10" r="1.4" />
                <circle cx="10" cy="10" r="1.4" />
                <circle cx="16" cy="10" r="1.4" />
              </svg>
            </button>
            {menuOpen ? (
              <div
                role="menu"
                className="absolute right-0 top-8 z-30 w-48 rounded-[var(--radius-sm)] border border-hair-2 bg-card-2 p-1 shadow-xl"
              >
                {allowedDispositions(obj).map((d) => (
                  <button
                    key={d}
                    type="button"
                    role="menuitem"
                    onClick={() => choose(d)}
                    className="flex w-full items-center justify-between gap-2 rounded-[var(--radius-sm)] px-2.5 py-1.5 text-left text-[13px] text-ink-2 hover:bg-card-hover hover:text-ink"
                  >
                    <span>{dispositionLabel(d)}</span>
                    {d === disposition ? (
                      <svg
                        className="h-3.5 w-3.5 shrink-0 text-accent"
                        viewBox="0 0 20 20"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2}
                        aria-hidden
                      >
                        <path d="M4 10.5l4 4 8-9" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    ) : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {obj.kind !== "family_member" ? (
        <div className="mt-2 flex items-baseline justify-between gap-2">
          <span className={`tabular text-[14px] ${ghost ? "text-ink-3" : "text-ink"}`}>
            {currency.format(figure)}
            {isFlow ? <span className="ml-0.5 text-[11px] text-ink-3">/yr</span> : null}
          </span>
          {showBasis ? (
            <span className="tabular text-[11px] text-ink-3">
              basis {currency.format(basisFigure)}
            </span>
          ) : null}
        </div>
      ) : null}

      {disposition === "split" && splitPercentToSpouse != null ? (
        <div className="mt-2 flex items-center gap-1.5 text-[11px] text-ink-3">
          <span className="chip px-2 py-0.5 text-[10px]">
            Split <span className="tabular">{splitPercentToSpouse}%</span>
          </span>
          <span>to {spouseName}</span>
        </div>
      ) : null}

      {childObjects && childObjects.length > 0 ? (
        <div className="mt-2.5 border-t border-hair pt-2">
          <div className="mb-1 text-[10px] uppercase tracking-wide text-ink-4">
            Held in entity
          </div>
          <ul className="flex flex-col gap-1">
            {childObjects.map((c) => (
              <li
                key={c.id}
                className="flex items-baseline justify-between gap-2 pl-2 text-[12px] text-ink-3"
              >
                <span className="truncate">{c.label}</span>
                <span className="tabular shrink-0">{currency.format(c.value)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
