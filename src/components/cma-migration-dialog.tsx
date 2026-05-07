"use client";

import { useState, useEffect, useCallback } from "react";
import DialogShell from "./dialog-shell";

type Remapping =
  | { kind: "remap"; toClassName: string }
  | { kind: "keep" }
  | { kind: "delete" };

interface Preview {
  assetClasses: {
    added: { name: string }[];
    removed: {
      id: string;
      name: string;
      accountAllocCount: number;
      portfolioAllocCount: number;
      suggestedTargetName: string | null;
    }[];
    unchanged: { id: string; name: string }[];
  };
  correlationPairsToAdd: number;
  allTargetNames: { name: string; alreadyInFirm: boolean }[];
}

interface CmaMigrationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful migration so the parent can re-fetch CMAs. */
  onMigrated: () => void;
}

export default function CmaMigrationDialog({
  open,
  onOpenChange,
  onMigrated,
}: CmaMigrationDialogProps) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [decisions, setDecisions] = useState<Record<string, Remapping>>({});
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPreview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/cma/migration-preview");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as Preview;
      setPreview(data);

      // Default decisions per removed class:
      //  - if there's a suggested target, default to remap onto it
      //  - else if any target is available, default to remap onto the first
      //  - else default to keep
      const defaults: Record<string, Remapping> = {};
      const fallback = data.allTargetNames[0]?.name;
      for (const r of data.assetClasses.removed) {
        const target = r.suggestedTargetName ?? fallback;
        defaults[r.id] = target
          ? { kind: "remap", toClassName: target }
          : { kind: "keep" };
      }
      setDecisions(defaults);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load preview");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) fetchPreview();
  }, [open, fetchPreview]);

  async function submit() {
    if (!preview) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/cma/migrate-to-standard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ remappings: decisions }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      onMigrated();
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Migration failed");
    } finally {
      setSubmitting(false);
    }
  }

  function setDecision(id: string, r: Remapping) {
    setDecisions((prev) => ({ ...prev, [id]: r }));
  }

  const noChanges =
    preview &&
    preview.assetClasses.added.length === 0 &&
    preview.assetClasses.removed.length === 0 &&
    preview.correlationPairsToAdd === 0;

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title="Update to standard CMAs"
      size="lg"
      primaryAction={
        preview && !noChanges
          ? {
              label: submitting ? "Migrating…" : "Confirm migration",
              onClick: submit,
              disabled: loading || submitting,
              loading: submitting,
            }
          : undefined
      }
    >
      {loading && (
        <p className="text-sm text-ink-2">Loading comparison…</p>
      )}

      {error && (
        <p
          role="alert"
          className="mb-4 rounded bg-red-900/40 px-3 py-2 text-sm text-red-300"
        >
          {error}
        </p>
      )}

      {preview && noChanges && (
        <p className="text-sm text-ink-2">
          Your CMAs already match the standard set — nothing to migrate.
        </p>
      )}

      {preview && !noChanges && (
        <div className="space-y-6">
          <Section
            title={`Adding ${preview.assetClasses.added.length} new asset class${preview.assetClasses.added.length === 1 ? "" : "es"}`}
          >
            {preview.assetClasses.added.length === 0 ? (
              <p className="text-sm text-ink-3">None — all standard classes are already present.</p>
            ) : (
              <ul className="list-disc pl-5 text-sm text-ink-2">
                {preview.assetClasses.added.map((a) => (
                  <li key={a.name}>{a.name}</li>
                ))}
              </ul>
            )}
          </Section>

          <Section
            title={`${preview.assetClasses.removed.length} legacy asset class${preview.assetClasses.removed.length === 1 ? "" : "es"} no longer in the standard set`}
          >
            {preview.assetClasses.removed.length === 0 ? (
              <p className="text-sm text-ink-3">None.</p>
            ) : (
              <div className="space-y-3">
                {preview.assetClasses.removed.map((r) => (
                  <RemovedRow
                    key={r.id}
                    removed={r}
                    decision={decisions[r.id]}
                    targets={preview.allTargetNames}
                    onChange={(next) => setDecision(r.id, next)}
                  />
                ))}
              </div>
            )}
          </Section>

          <Section title="Correlations">
            <p className="text-sm text-ink-2">
              {preview.correlationPairsToAdd === 0
                ? "All standard correlation pairs are already present."
                : `Filling in ${preview.correlationPairsToAdd} missing correlation pair${preview.correlationPairsToAdd === 1 ? "" : "s"} from the standard matrix. Existing custom correlations are preserved.`}
            </p>
          </Section>
        </div>
      )}
    </DialogShell>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-ink">{title}</h3>
      {children}
    </div>
  );
}

function RemovedRow({
  removed,
  decision,
  targets,
  onChange,
}: {
  removed: {
    id: string;
    name: string;
    accountAllocCount: number;
    portfolioAllocCount: number;
    suggestedTargetName: string | null;
  };
  decision: Remapping | undefined;
  targets: { name: string; alreadyInFirm: boolean }[];
  onChange: (next: Remapping) => void;
}) {
  const inUse =
    removed.accountAllocCount > 0 || removed.portfolioAllocCount > 0;
  const usage: string[] = [];
  if (removed.accountAllocCount > 0) {
    usage.push(
      `${removed.accountAllocCount} account ${removed.accountAllocCount === 1 ? "allocation" : "allocations"}`
    );
  }
  if (removed.portfolioAllocCount > 0) {
    usage.push(
      `${removed.portfolioAllocCount} portfolio ${removed.portfolioAllocCount === 1 ? "allocation" : "allocations"}`
    );
  }

  const kind = decision?.kind ?? "keep";
  const currentTarget =
    decision?.kind === "remap" ? decision.toClassName : "";

  return (
    <div className="rounded-md border border-hair p-3">
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-sm font-medium text-ink">{removed.name}</div>
        <div className="text-xs text-ink-3">
          {usage.length === 0 ? "Unused" : `Used by ${usage.join(", ")}`}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <KindRadio
          value="remap"
          current={kind}
          label="Remap to:"
          onSelect={() =>
            onChange({
              kind: "remap",
              toClassName:
                decision?.kind === "remap"
                  ? decision.toClassName
                  : (removed.suggestedTargetName ?? targets[0]?.name ?? ""),
            })
          }
          disabled={targets.length === 0}
        />
        {kind === "remap" && (
          <select
            value={currentTarget}
            onChange={(e) =>
              onChange({ kind: "remap", toClassName: e.target.value })
            }
            className="rounded border border-hair bg-card px-2 py-1 text-sm text-ink"
          >
            {targets.map((t) => (
              <option key={t.name} value={t.name}>
                {t.name}
                {t.alreadyInFirm ? "" : " (new)"}
              </option>
            ))}
          </select>
        )}

        <KindRadio
          value="keep"
          current={kind}
          label="Keep as legacy"
          onSelect={() => onChange({ kind: "keep" })}
        />

        <KindRadio
          value="delete"
          current={kind}
          label="Delete"
          onSelect={() => onChange({ kind: "delete" })}
          disabled={inUse}
          disabledHint={
            inUse ? "Disabled because allocations reference this class" : undefined
          }
        />
      </div>

      {removed.suggestedTargetName && kind === "remap" && (
        <p className="mt-2 text-xs text-ink-3">
          Suggested: {removed.suggestedTargetName}
        </p>
      )}
    </div>
  );
}

function KindRadio({
  value,
  current,
  label,
  onSelect,
  disabled,
  disabledHint,
}: {
  value: "remap" | "keep" | "delete";
  current: "remap" | "keep" | "delete";
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  disabledHint?: string;
}) {
  return (
    <label
      className={`flex items-center gap-1.5 text-sm ${disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer text-ink-2 hover:text-ink"}`}
      title={disabled ? disabledHint : undefined}
    >
      <input
        type="radio"
        checked={current === value}
        onChange={onSelect}
        disabled={disabled}
      />
      {label}
    </label>
  );
}
