// src/components/forge/fact-finder-duplicate-card.tsx
"use client";

interface Candidate {
  householdId: string;
  clientId: string | null;
  name: string;
  status: string;
}

export function FactFinderDuplicateCard({
  householdName,
  candidates,
  onUpdate,
  onCreateSeparate,
  onCancel,
}: {
  householdName: string;
  candidates: Candidate[];
  onUpdate: (clientId: string) => void;
  onCreateSeparate: () => void;
  onCancel: () => void;
}) {
  // First candidate that actually has a plan is the update target; if none has a
  // plan, "Update" is disabled (nothing to update) and the advisor can still
  // create separate.
  const updatable = candidates.find((c) => c.clientId != null) ?? null;
  return (
    <div className="space-y-2 rounded-[var(--radius)] border border-hair bg-card-2 p-3">
      <p className="text-[13px] text-ink">
        A household named <span className="font-medium">{householdName}</span> already exists. What
        would you like to do?
      </p>
      <ul className="text-[12px] text-ink-3">
        {candidates.map((c) => (
          <li key={c.householdId}>
            {c.name} — {c.clientId ? "has a plan" : "no plan yet"} ({c.status})
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2 pt-1">
        <button
          type="button"
          disabled={!updatable}
          onClick={() => updatable && onUpdate(updatable.clientId!)}
          className="rounded-[var(--radius-sm)] border border-hair px-3 py-1.5 text-[12px] text-ink hover:bg-card disabled:opacity-40"
        >
          Update existing plan
        </button>
        <button
          type="button"
          onClick={onCreateSeparate}
          className="rounded-[var(--radius-sm)] border border-hair px-3 py-1.5 text-[12px] text-ink hover:bg-card"
        >
          Create separate household
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-[var(--radius-sm)] px-3 py-1.5 text-[12px] text-ink-3 hover:text-ink"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
