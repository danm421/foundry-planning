"use client";

// A group of selectable people pills. Two or more picks show an inline %
// box each; adding or removing a pick re-splits evenly. The wizard's People
// step uses it twice, and the CLT setup reuses it for "Gets what's left".

import { useState } from "react";
import { evenShares, personKey, type PersonOption, type PersonRef, type PersonShare } from "@/lib/solver/guided-trust";

interface Props {
  label: string;
  note?: string;
  options: PersonOption[];
  value: PersonShare[];
  onChange: (next: PersonShare[]) => void;
}

export function GuidedTrustPeoplePicker({ label, note, options, value, onChange }: Props) {
  const picked = new Map(value.map((s) => [personKey(s.person), s]));

  function toggle(ref: PersonRef) {
    const key = personKey(ref);
    const people = value.map((s) => s.person);
    onChange(
      evenShares(picked.has(key) ? people.filter((p) => personKey(p) !== key) : [...people, ref]),
    );
  }

  function setPercent(key: string, percentage: number) {
    onChange(value.map((s) => (personKey(s.person) === key ? { ...s, percentage } : s)));
  }

  return (
    <div role="group" aria-label={label} className="mb-3.5">
      <div className="text-[13px] font-medium text-ink">{label}</div>
      {note ? <div className="mb-1.5 text-[11.5px] leading-snug text-ink-3">{note}</div> : null}
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const key = personKey(o.ref);
          const share = picked.get(key);
          return (
            <span
              key={key}
              className={`inline-flex items-center rounded-full border text-[12.5px] ${
                share ? "border-accent bg-accent-wash text-ink" : "border-hair-2 text-ink-2"
              }`}
            >
              <button
                type="button"
                aria-pressed={!!share}
                onClick={() => toggle(o.ref)}
                className="rounded-full px-2.5 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
              >
                {o.label}
              </button>
              {share && value.length >= 2 ? (
                <span className="mr-2 inline-flex items-center gap-0.5 text-ink-3">
                  <PercentBox
                    label={`Percent for ${o.label}`}
                    value={share.percentage}
                    onCommit={(n) => setPercent(key, n)}
                  />
                  %
                </span>
              ) : null}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/** A % box that keeps what's being typed as text, so it can be blanked and
 *  retyped. Only a value that parses to a number is committed, clamped to
 *  0–100; on blur the box shows the committed value. */
function PercentBox({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number;
  onCommit: (n: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      type="number"
      min={0}
      max={100}
      step="any"
      aria-label={label}
      value={draft ?? String(value)}
      onChange={(e) => {
        const text = e.target.value;
        setDraft(text);
        const n = text.trim() === "" ? NaN : Number(text);
        if (Number.isFinite(n)) onCommit(Math.min(100, Math.max(0, n)));
      }}
      onBlur={() => setDraft(null)}
      className="tabular h-5 w-12 rounded-[var(--radius-sm)] border border-hair-2 bg-paper px-1 text-right text-[12px] text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/25"
    />
  );
}
