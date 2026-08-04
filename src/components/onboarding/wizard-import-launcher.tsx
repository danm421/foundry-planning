"use client";

import { useCallback, useState } from "react";
import type { ImportEligibleStep } from "@/lib/onboarding/import-sections";
import WizardImportDrawer from "./wizard-import-drawer";

interface WizardImportLauncherProps {
  clientId: string;
  step: ImportEligibleStep;
  baseScenarioId: string;
  activeImportId: string | null;
}

export default function WizardImportLauncher({
  clientId,
  step,
  baseScenarioId,
  activeImportId,
}: WizardImportLauncherProps) {
  const [open, setOpen] = useState(false);
  // Stable identity — the drawer keys an effect off onClose.
  const handleClose = useCallback(() => setOpen(false), []);

  return (
    <>
      <div
        data-forge-anchor="wizard-import-launcher"
        className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-[var(--radius-sm)] border border-hair bg-card-2/40 px-3.5 py-3"
      >
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-sm)] border border-hair bg-card px-3 text-[13px] font-medium text-ink-2 transition-colors hover:border-accent/50 hover:text-ink"
        >
          Upload a statement
        </button>
        <span className="text-[13px] text-ink-3">
          and we&apos;ll fill this step in — or add them manually below.
        </span>
      </div>
      {open ? (
        <WizardImportDrawer
          clientId={clientId}
          step={step}
          baseScenarioId={baseScenarioId}
          activeImportId={activeImportId}
          onClose={handleClose}
        />
      ) : null}
    </>
  );
}
