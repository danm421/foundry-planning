"use client";

import type { DuplicateMatch, PreviewResult } from "@/components/crm-import-wizard";
import type { ParsedRow } from "@/lib/crm/import/rows";

export type Resolved =
  | { kind: "create" }
  | { kind: "skip"; householdId: string }
  | { kind: "blocked" };

/**
 * The single source of truth for what a row will do on commit. The stat
 * tiles and the table both call this, and the wizard's `buildDecisions`
 * calls this same function (rather than re-deriving the precedence) so
 * they can never disagree with each other or with the actual commit
 * payload.
 */
export function resolve(
  row: ParsedRow,
  matches: DuplicateMatch[] | undefined,
  choices: Record<number, string>,
): Resolved {
  if (row.errors.length > 0) return { kind: "blocked" };
  const choice = choices[row.rowIndex];
  if (choice === "create") return { kind: "create" };
  if (choice) return { kind: "skip", householdId: choice };
  return matches?.length
    ? { kind: "skip", householdId: matches[0].id }
    : { kind: "create" };
}

interface CrmImportPreviewProps {
  preview: PreviewResult;
  /** rowIndex → "create" or a matched household id. Absent = default. */
  choices: Record<number, string>;
  onChange: (next: Record<number, string>) => void;
}

export function CrmImportPreview({ preview, choices, onChange }: CrmImportPreviewProps) {
  const duplicatesByRow = new Map(preview.duplicates.map((d) => [d.rowIndex, d.matches]));

  let createCount = 0;
  let skipCount = 0;
  let blockedCount = 0;
  for (const row of preview.rows) {
    const resolved = resolve(row, duplicatesByRow.get(row.rowIndex), choices);
    if (resolved.kind === "create") createCount++;
    else if (resolved.kind === "skip") skipCount++;
    else blockedCount++;
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat testId="stat-create" label="To create" value={createCount} tone="accent" />
        <Stat testId="stat-skip" label="To skip" value={skipCount} tone="ink-3" />
        <Stat testId="stat-blocked" label="Won't import" value={blockedCount} tone="crit" />
      </div>

      {preview.partialDedupCorpus && (
        <div
          role="status"
          className="rounded-[var(--radius-sm)] border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[13px] text-amber-700 dark:text-amber-300"
        >
          Duplicate detection was checked against only the first 1,000 existing
          households. Matches beyond that page may be missed — review the
          imported rows after commit.
        </div>
      )}

      {preview.truncated && (
        <div
          role="status"
          className="rounded-[var(--radius-sm)] border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[13px] text-amber-700 dark:text-amber-300"
        >
          Only the first 1,000 rows of this file were read.
        </div>
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
              {preview.rows.map((row) => {
                const matches = duplicatesByRow.get(row.rowIndex);
                const resolved = resolve(row, matches, choices);
                return (
                  <tr key={row.rowIndex} className={matches?.length ? "bg-card-2" : undefined}>
                    <td className="whitespace-nowrap px-6 py-4">
                      <span className="font-medium text-ink">
                        Row {row.rowIndex + 1}
                        {row.household.name ? ` — ${row.household.name}` : ""}
                      </span>
                      {row.household.nameIsCustom === false && row.household.name && (
                        <span className="ml-2 rounded-[var(--radius-sm)] bg-card-2 px-1.5 py-0.5 text-[11px] text-ink-3">
                          Generated
                        </span>
                      )}
                      <div className="text-[12px] text-ink-3">{row.household.status}</div>
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-ink-2">
                      {row.primary.firstName} {row.primary.lastName}
                      {row.primary.email && (
                        <div className="text-[12px] text-ink-3">{row.primary.email}</div>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-ink-2">
                      {row.spouse ? `${row.spouse.firstName} ${row.spouse.lastName}` : "—"}
                    </td>
                    <td className="px-6 py-4 text-sm">
                      {resolved.kind === "blocked" ? (
                        <span className="text-crit">Won&apos;t import</span>
                      ) : matches?.length ? (
                        <DuplicateResolver
                          matches={matches}
                          resolved={resolved}
                          rowIndex={row.rowIndex}
                          choices={choices}
                          onChange={onChange}
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

interface DuplicateResolverProps {
  matches: DuplicateMatch[];
  resolved: Resolved;
  rowIndex: number;
  choices: Record<number, string>;
  onChange: (next: Record<number, string>) => void;
}

function DuplicateResolver({
  matches,
  resolved,
  rowIndex,
  choices,
  onChange,
}: DuplicateResolverProps) {
  // Shared name groups the two radios so keyboard arrow keys move
  // between them and screen readers announce them as a single choice.
  const groupName = `decision-${rowIndex}`;
  const matchedId = resolved.kind === "skip" ? resolved.householdId : (matches[0]?.id ?? "");
  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-[13px]">
        <input
          type="radio"
          name={groupName}
          checked={resolved.kind === "create"}
          onChange={() => onChange({ ...choices, [rowIndex]: "create" })}
          className="accent-current text-accent"
        />
        <span className="text-ink-2">Create new</span>
      </label>
      <label className="flex items-center gap-2 text-[13px]">
        <input
          type="radio"
          name={groupName}
          checked={resolved.kind === "skip"}
          onChange={() => onChange({ ...choices, [rowIndex]: matches[0]?.id ?? "" })}
          className="accent-current text-accent"
        />
        <span className="text-ink-2">Skip — matches existing</span>
      </label>
      {resolved.kind === "skip" && (
        <select
          value={matchedId}
          onChange={(e) => onChange({ ...choices, [rowIndex]: e.target.value })}
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
  testId,
  label,
  value,
  tone,
}: {
  testId: string;
  label: string;
  value: number;
  tone: "accent" | "ink-3" | "crit";
}) {
  const toneClass =
    tone === "accent" ? "text-accent" : tone === "crit" ? "text-crit" : "text-ink-2";
  return (
    <div className="rounded-[var(--radius-sm)] border border-hair bg-card-2 p-3">
      <div className="text-[12px] uppercase tracking-wider text-ink-3">{label}</div>
      <div data-testid={testId} className={`mt-1 text-2xl font-semibold ${toneClass}`}>
        {value}
      </div>
    </div>
  );
}
