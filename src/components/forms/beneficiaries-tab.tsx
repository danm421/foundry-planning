"use client";

import { useEffect, useState } from "react";
import BeneficiaryEditor from "../beneficiary-editor";
import type {
  Designation,
  FamilyMember,
  ExternalBeneficiary,
} from "../family-view";

interface BeneficiariesTabProps {
  clientId: string;
  accountId: string;
  active: boolean;
}

export default function BeneficiariesTab({ clientId, accountId, active }: BeneficiariesTabProps) {
  const [loaded, setLoaded] = useState(false);
  const [designations, setDesignations] = useState<Designation[]>([]);
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [externals, setExternals] = useState<ExternalBeneficiary[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active || loaded) return;
    setError(null);
    let cancelled = false;
    async function load() {
      try {
        const [dRes, mRes, eRes] = await Promise.all([
          fetch(`/api/clients/${clientId}/accounts/${accountId}/beneficiaries`),
          fetch(`/api/clients/${clientId}/family-members`),
          fetch(`/api/clients/${clientId}/external-beneficiaries`),
        ]);
        if (!dRes.ok || !mRes.ok || !eRes.ok) throw new Error("Failed to load beneficiary data");
        const [d, m, e] = (await Promise.all([dRes.json(), mRes.json(), eRes.json()])) as [
          Designation[],
          FamilyMember[],
          ExternalBeneficiary[],
        ];
        if (cancelled) return;
        setDesignations(d);
        setMembers(m);
        setExternals(e);
        setLoaded(true);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [active, loaded, clientId, accountId]);

  if (error) return <p className="text-sm text-red-400">{error}</p>;
  if (!loaded) return <p className="text-sm text-gray-300">Loading…</p>;

  return (
    <BeneficiaryEditor
      target={{ kind: "account", accountId }}
      clientId={clientId}
      members={members}
      externals={externals}
      initial={designations}
      onSaved={(rows) => setDesignations(rows)}
    />
  );
}
