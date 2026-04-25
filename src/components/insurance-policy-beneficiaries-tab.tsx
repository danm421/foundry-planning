"use client";

import { useEffect, useState } from "react";
import BeneficiaryEditor from "./beneficiary-editor";
import type {
  Designation,
  FamilyMember,
  ExternalBeneficiary,
} from "./family-view";

interface InsurancePolicyBeneficiariesTabProps {
  clientId: string;
  mode: "create" | "edit";
  policyId?: string;
  members: FamilyMember[];
  externals: ExternalBeneficiary[];
}

// DB rows ship `percentage` as a decimal string. `Designation` wants a number,
// so we normalize here before handing to BeneficiaryEditor.
type DesignationRow = Omit<Designation, "percentage"> & {
  percentage: number | string;
};

function normalize(rows: DesignationRow[]): Designation[] {
  return rows.map((r) => ({
    ...r,
    percentage:
      typeof r.percentage === "string" ? parseFloat(r.percentage) : r.percentage,
  }));
}

export default function InsurancePolicyBeneficiariesTab({
  clientId,
  mode,
  policyId,
  members,
  externals,
}: InsurancePolicyBeneficiariesTabProps) {
  const isCreate = mode === "create" || !policyId;

  const [loading, setLoading] = useState(!isCreate);
  const [designations, setDesignations] = useState<Designation[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isCreate) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    async function load() {
      try {
        const res = await fetch(
          `/api/clients/${clientId}/accounts/${policyId}/beneficiaries`,
        );
        if (cancelled) return;
        if (res.status === 401) {
          setError("Unauthorized");
          setLoading(false);
          return;
        }
        if (res.status === 404) {
          // Policy exists but has no designations yet — let the editor start
          // from an empty list.
          setDesignations([]);
          setLoading(false);
          return;
        }
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        const rows = (await res.json()) as DesignationRow[];
        if (cancelled) return;
        setDesignations(normalize(rows));
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [isCreate, clientId, policyId]);

  if (isCreate) {
    return (
      <div className="py-6">
        <div className="rounded-md border border-hair bg-card-2 px-4 py-3 text-sm text-ink-3">
          Save the policy first. Beneficiaries can be set after the policy has
          been created.
        </div>
      </div>
    );
  }

  if (loading) {
    return <p className="py-6 text-sm text-ink-3">Loading…</p>;
  }

  if (error) {
    return <p className="py-6 text-sm text-crit">{error}</p>;
  }

  return (
    <BeneficiaryEditor
      target={{ kind: "account", accountId: policyId! }}
      clientId={clientId}
      members={members}
      externals={externals}
      initial={designations}
      onSaved={() => {
        // BeneficiaryEditor handles its own save flow; we don't need to
        // propagate changes back up to the dialog.
      }}
    />
  );
}
