"use client";

import { useState, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import PortalCard, { portalInput } from "@/components/portal/portal-card";
import { SlidersIcon } from "@/components/portal/portal-icons";
import { BrandSelect } from "@/components/brand-select";
import type { BrandChoice, BrandOption } from "@/lib/branding/brand-choice";

interface Props {
  clientId: string;
  choices: BrandOption[];
  initialValue: BrandChoice;
}

/**
 * Which brand this household sees: its portal and client PDFs, and where
 * intake sends and presentations for it start. Saves on change, optimistic
 * like `PortalFeatureToggles`: set, PUT, put it back on failure.
 */
export default function HouseholdBrandCard({ clientId, choices, initialValue }: Props): ReactElement {
  const router = useRouter();
  const [value, setValue] = useState(initialValue);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function change(next: BrandChoice): Promise<void> {
    const previous = value;
    setValue(next);
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/clients/${clientId}/brand`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ brand: next }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setValue(previous);
      const body = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
      setError(body?.error ?? "Could not save that change. Please try again.");
      return;
    }
    router.refresh();
  }

  return (
    <PortalCard
      icon={<SlidersIcon />}
      title="Brand"
      description="The portal and new sends start on this brand."
    >
      <label htmlFor="household-brand" className="mb-1 block text-[12px] text-ink-3">
        Brand
      </label>
      <BrandSelect
        id="household-brand"
        choices={choices}
        value={value}
        onChange={(next) => void change(next)}
        disabled={busy}
        className={portalInput}
      />
      {error && (
        <p role="alert" className="mt-3 text-[12px] text-crit">
          {error}
        </p>
      )}
    </PortalCard>
  );
}
