"use client";

import type { DryRunResult } from "@/components/crm-import-wizard";

// Re-exported from the wizard so the API surface stays in one file.
type ProposedHousehold = DryRunResult["rowsToCreate"][number];
type DryRunMatch = DryRunResult["duplicates"][number]["matches"][number];

export type Decision =
  | { action: "create"; row: ProposedHousehold }
  | { action: "skip"; row: ProposedHousehold; matchedHouseholdId: string };

interface CrmImportPreviewProps {
  dryRun: DryRunResult;
  decisions: Decision[];
  onChange: (next: Decision[]) => void;
}

export function CrmImportPreview({
  dryRun,
  decisions,
  onChange,
}: CrmImportPreviewProps) {
  const newCount = decisions.filter((d) => d.action === "create").length;
  const skipCount = decisions.filter((d) => d.action === "skip").length;

  function updateDecision(idx: number, next: Decision) {
    const copy = decisions.slice();
    copy[idx] = next;
    onChange(copy);
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="To create" value={newCount} tone="accent" />
        <Stat label="To skip" value={skipCount} tone="ink-3" />
        <Stat label="Parse errors" value={dryRun.errors.length} tone="crit" />
      </div>

      {dryRun.errors.length > 0 && (
        <section>
          <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wider text-ink-3">
            Skipped — invalid rows
          </h2>
          <div className="overflow-hidden rounded-lg border border-hair bg-card shadow-sm">
            <table className="min-w-full divide-y divide-hair">
              <thead className="bg-card-2">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-ink-3">
                    Row
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-ink-3">
                    Problems
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hair">
                {dryRun.errors.map((e) => (
                  <tr key={e.rowIndex}>
                    <td className="whitespace-nowrap px-6 py-3 text-sm text-ink-2">
                      {e.rowIndex + 1}
                    </td>
                    <td className="px-6 py-3 text-sm text-crit">
                      <ul className="list-disc pl-4">
                        {e.messages.map((m, i) => (
                          <li key={i}>{m}</li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wider text-ink-3">
          Rows to import
        </h2>
        <div className="overflow-hidden rounded-lg border border-hair bg-card shadow-sm">
          <table className="min-w-full divide-y divide-hair">
            <thead className="bg-card-2">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-ink-3">
                  Household
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-ink-3">
                  Primary
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-ink-3">
                  Spouse
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-ink-3">
                  Decision
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hair">
              {decisions.map((d, idx) => {
                const dup = findDuplicate(dryRun, d.row);
                return (
                  <tr key={idx} className={dup ? "bg-card-2" : undefined}>
                    <td className="whitespace-nowrap px-6 py-4">
                      <span className="font-medium text-ink">{d.row.household.name}</span>
                      <div className="text-[12px] text-ink-3">
                        {d.row.household.status}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-ink-2">
                      {d.row.primary.firstName} {d.row.primary.lastName}
                      {d.row.primary.email && (
                        <div className="text-[12px] text-ink-3">
                          {d.row.primary.email}
                        </div>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-ink-2">
                      {d.row.spouse
                        ? `${d.row.spouse.firstName} ${d.row.spouse.lastName}`
                        : "—"}
                    </td>
                    <td className="px-6 py-4 text-sm">
                      {dup ? (
                        <DuplicateResolver
                          matches={dup.matches}
                          decision={d}
                          onChange={(next) => updateDecision(idx, next)}
                          row={d.row}
                        />
                      ) : (
                        <span className="text-accent">Create new</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function findDuplicate(
  dryRun: DryRunResult,
  row: ProposedHousehold,
): DryRunResult["duplicates"][number] | undefined {
  return dryRun.duplicates.find((d) => d.row === row);
}

interface DuplicateResolverProps {
  matches: DryRunMatch[];
  decision: Decision;
  row: ProposedHousehold;
  onChange: (next: Decision) => void;
}

function DuplicateResolver({
  matches,
  decision,
  row,
  onChange,
}: DuplicateResolverProps) {
  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-[13px]">
        <input
          type="radio"
          checked={decision.action === "create"}
          onChange={() => onChange({ action: "create", row })}
          className="accent-current text-accent"
        />
        <span className="text-ink-2">Create new</span>
      </label>
      <label className="flex items-center gap-2 text-[13px]">
        <input
          type="radio"
          checked={decision.action === "skip"}
          onChange={() =>
            onChange({
              action: "skip",
              row,
              matchedHouseholdId: matches[0]?.id ?? "",
            })
          }
          className="accent-current text-accent"
        />
        <span className="text-ink-2">Skip — matches existing</span>
      </label>
      {decision.action === "skip" && (
        <select
          value={decision.matchedHouseholdId}
          onChange={(e) =>
            onChange({
              action: "skip",
              row,
              matchedHouseholdId: e.target.value,
            })
          }
          className="ml-6 h-8 rounded-[var(--radius-sm)] border border-hair bg-card-2 px-2 text-[12px] text-ink"
        >
          {matches.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} ({m.score}%)
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "accent" | "ink-3" | "crit";
}) {
  const toneClass =
    tone === "accent" ? "text-accent" : tone === "crit" ? "text-crit" : "text-ink-2";
  return (
    <div className="rounded-[var(--radius-sm)] border border-hair bg-card-2 p-3">
      <div className="text-[12px] uppercase tracking-wider text-ink-3">
        {label}
      </div>
      <div className={`mt-1 text-2xl font-semibold ${toneClass}`}>{value}</div>
    </div>
  );
}
