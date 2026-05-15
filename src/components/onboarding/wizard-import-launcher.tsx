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
      <div className="mb-4 flex justify-end">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-sm)] border border-hair bg-card-2 px-3 text-[13px] font-medium text-ink-2 transition-colors hover:border-accent/50 hover:text-ink"
        >
          Import from document
        </button>
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
