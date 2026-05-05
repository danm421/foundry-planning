"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardBody, CardHeader } from "@/components/card";

interface ScenarioOption {
  id: string;
  name: string;
  isBaseCase: boolean;
}

interface ModePickerClientProps {
  clientId: string;
  scenarios: ScenarioOption[];
  defaultScenarioId: string | null;
}

type Mode = "onboarding" | "updating";

export default function ModePickerClient({
  clientId,
  scenarios,
  defaultScenarioId,
}: ModePickerClientProps) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("onboarding");
  const [scenarioId, setScenarioId] = useState<string | null>(
    defaultScenarioId,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updatingDisabled = scenarios.length === 0;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (mode === "updating" && !scenarioId) {
      setError("Pick a target scenario.");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/imports`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          scenarioId: mode === "updating" ? scenarioId : null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Create failed (${res.status})`);
      }
      const { import: imp } = (await res.json()) as {
        import: { id: string };
      };
      router.push(
        `/clients/${clientId}/client-data/import/${imp.id}`,
      );
    } catch (err) {
      setIsSubmitting(false);
      setError(err instanceof Error ? err.message : "Create failed");
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-ink">New import</h1>
        <Link
          href={`/clients/${clientId}/client-data/import`}
          className="text-sm text-ink-3 underline-offset-2 hover:underline"
        >
          ← Back to imports
        </Link>
      </div>

      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-2">
            Mode
          </h2>
        </CardHeader>
        <CardBody>
          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            <fieldset className="flex flex-col gap-3">
              <ModeOption
                value="onboarding"
                checked={mode === "onboarding"}
                onChange={() => setMode("onboarding")}
                title="Onboarding"
                description="First-time data entry. Extracted rows are inserted as new entities; no merge logic runs."
              />
              <ModeOption
                value="updating"
                checked={mode === "updating"}
                onChange={() => setMode("updating")}
                title="Updating"
                description="Match extracted rows against an existing scenario. Each row is flagged as exact, ambiguous, or new."
                disabled={updatingDisabled}
                disabledReason={
                  updatingDisabled ? "No scenarios exist for this client yet." : undefined
                }
              />
            </fieldset>

            {mode === "updating" ? (
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-ink-2">Target scenario</span>
                <select
                  value={scenarioId ?? ""}
                  onChange={(e) => setScenarioId(e.target.value || null)}
                  className="rounded border border-hair bg-card-2 px-3 py-2 text-ink"
                >
                  {scenarios.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.isBaseCase ? `${s.name} (base)` : s.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            {error ? (
              <p role="alert" className="text-sm text-crit">
                {error}
              </p>
            ) : null}

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={isSubmitting}
                className="rounded bg-accent px-5 py-2 text-sm font-medium text-accent-on hover:bg-accent/90 disabled:opacity-50"
              >
                {isSubmitting ? "Creating…" : "Continue"}
              </button>
            </div>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}

interface ModeOptionProps {
  value: Mode;
  checked: boolean;
  onChange: () => void;
  title: string;
  description: string;
  disabled?: boolean;
  disabledReason?: string;
}

function ModeOption({
  value,
  checked,
  onChange,
  title,
  description,
  disabled,
  disabledReason,
}: ModeOptionProps) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-3 rounded border p-3 transition-colors ${
        checked
          ? "border-accent bg-accent/5"
          : "border-hair hover:border-ink-4"
      } ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
    >
      <input
        type="radio"
        name="mode"
        value={value}
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        className="mt-1"
      />
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-ink">{title}</span>
        <span className="text-xs text-ink-3">{description}</span>
        {disabled && disabledReason ? (
          <span className="text-xs text-ink-4">{disabledReason}</span>
        ) : null}
      </div>
    </label>
  );
}
