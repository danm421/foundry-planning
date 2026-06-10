"use client";

import { useMemo, useState } from "react";
import type { Account, ClientData, EntitySummary } from "@/engine/types";
import type { SolverMutation } from "@/lib/solver/types";
import {
  SOLVER_TRUST_SUBTYPES_3A,
  type SolverTrustSubType3a,
  buildTrustEntity,
  buildIlitFundingMutation,
  buildRetitleFundingMutation,
  isRetitleFundingEligible,
} from "@/lib/solver/trust-levers";
import { SolverSplitInterestForm } from "./solver-split-interest-form";

/** 3a subtypes plus the 3b split-interest subtypes the picker can now create. */
type SolverTrustSubType = SolverTrustSubType3a | "crt" | "clt";

const SUBTYPE_LABELS: Record<SolverTrustSubType, string> = {
  ilit: "ILIT (life-insurance trust)",
  idgt: "IDGT (intentionally defective grantor trust)",
  irrevocable: "Irrevocable (generic)",
  crt: "CRT (charitable remainder trust)",
  clt: "CLT (charitable lead trust)",
};

export interface SolverTrustDraft {
  entity: EntitySummary;
  /** Accounts retitled into the trust, captured BEFORE retitle (for revert). */
  fundedOriginals: Account[];
  /** CLT only: id of the auto-emitted remainder-interest gift, cleared on removal. */
  remainderGiftId?: string;
}

interface Props {
  clientData: ClientData;
  isMarried: boolean;
  /** Emits an external-beneficiary-upsert for a new charity; returns its id. */
  onCreateCharity: (name: string, charityType: "public" | "private") => string;
  /** Returns the ordered primitive mutations to emit (entity first) + the draft. */
  onApply: (mutations: SolverMutation[], draft: SolverTrustDraft) => void;
  onClose: () => void;
}

export function SolverTrustForm({
  clientData,
  isMarried,
  onCreateCharity,
  onApply,
  onClose,
}: Props) {
  const [subType, setSubType] = useState<SolverTrustSubType>("ilit");
  const [name, setName] = useState("New Trust");
  const [grantor, setGrantor] = useState<"client" | "spouse">("client");
  const [policyId, setPolicyId] = useState<string>("");
  const [retitleIds, setRetitleIds] = useState<Set<string>>(new Set());

  const policies = useMemo(
    () => clientData.accounts.filter((a) => a.category === "life_insurance"),
    [clientData.accounts],
  );
  const retitleEligible = useMemo(
    () => clientData.accounts.filter(isRetitleFundingEligible),
    [clientData.accounts],
  );

  function toggleRetitle(id: string) {
    setRetitleIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function apply() {
    if (!name.trim()) return;
    if (subType === "crt" || subType === "clt") return; // handled by the sub-form
    const entityId = crypto.randomUUID();
    const entity = buildTrustEntity({ id: entityId, name: name.trim(), subType, grantor });
    const mutations: SolverMutation[] = [{ kind: "entity-upsert", id: entityId, value: entity }];
    const fundedOriginals: Account[] = [];

    if (subType === "ilit") {
      const policy = policies.find((p) => p.id === policyId);
      if (policy) {
        mutations.push(buildIlitFundingMutation(policy, entityId, grantor, crypto.randomUUID()));
        fundedOriginals.push(policy);
      }
    } else {
      for (const a of retitleEligible) {
        if (retitleIds.has(a.id)) {
          mutations.push(buildRetitleFundingMutation(a, entityId));
          fundedOriginals.push(a);
        }
      }
    }

    onApply(mutations, { entity, fundedOriginals });
    onClose();
  }

  return (
    <div className="rounded-lg border border-hair-2 bg-card-2 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium text-ink">Add trust</span>
        <button
          type="button"
          onClick={onClose}
          className="text-[12px] text-ink-3 hover:text-ink"
        >
          Cancel
        </button>
      </div>

      <label className="block text-[12px] text-ink-2">
        Type
        <select
          value={subType}
          onChange={(e) => setSubType(e.target.value as SolverTrustSubType)}
          className="mt-1 h-9 w-full rounded-md border border-hair-2 bg-card px-2.5 text-[14px] text-ink focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
        >
          {SOLVER_TRUST_SUBTYPES_3A.map((s) => (
            <option key={s} value={s}>
              {SUBTYPE_LABELS[s]}
            </option>
          ))}
          <option value="crt">{SUBTYPE_LABELS.crt}</option>
          <option value="clt">{SUBTYPE_LABELS.clt}</option>
        </select>
      </label>

      {subType === "crt" || subType === "clt" ? (
        <SolverSplitInterestForm
          clientData={clientData}
          subType={subType}
          isMarried={isMarried}
          onCreateCharity={onCreateCharity}
          onApply={onApply}
          onClose={onClose}
        />
      ) : (
        <SolverTrustForm3aBody
          isMarried={isMarried}
          name={name}
          setName={setName}
          grantor={grantor}
          setGrantor={setGrantor}
          subType={subType}
          policies={policies}
          policyId={policyId}
          setPolicyId={setPolicyId}
          retitleEligible={retitleEligible}
          retitleIds={retitleIds}
          toggleRetitle={toggleRetitle}
          apply={apply}
        />
      )}
    </div>
  );
}

interface TrustForm3aBodyProps {
  isMarried: boolean;
  name: string;
  setName: (v: string) => void;
  grantor: "client" | "spouse";
  setGrantor: (v: "client" | "spouse") => void;
  subType: SolverTrustSubType3a;
  policies: Account[];
  policyId: string;
  setPolicyId: (v: string) => void;
  retitleEligible: Account[];
  retitleIds: Set<string>;
  toggleRetitle: (id: string) => void;
  apply: () => void;
}

/** The Phase 3a ILIT / IDGT / irrevocable body — byte-unchanged from before 3b. */
function SolverTrustForm3aBody({
  isMarried,
  name,
  setName,
  grantor,
  setGrantor,
  subType,
  policies,
  policyId,
  setPolicyId,
  retitleEligible,
  retitleIds,
  toggleRetitle,
  apply,
}: TrustForm3aBodyProps) {
  return (
    <>
      <label className="block text-[12px] text-ink-2">
        Name
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 h-9 w-full rounded-md border border-hair-2 bg-card px-2.5 text-[14px] text-ink focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
        />
      </label>

      {isMarried && (
        <label className="block text-[12px] text-ink-2">
          Grantor
          <select
            value={grantor}
            onChange={(e) => setGrantor(e.target.value as "client" | "spouse")}
            className="mt-1 h-9 w-full rounded-md border border-hair-2 bg-card px-2.5 text-[14px] text-ink focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
          >
            <option value="client">Client</option>
            <option value="spouse">Spouse</option>
          </select>
        </label>
      )}

      {subType === "ilit" ? (
        <label className="block text-[12px] text-ink-2">
          Policy to transfer into the ILIT
          {policies.length === 0 ? (
            <p className="mt-1 text-[12px] text-ink-3">
              No life-insurance policies to transfer.
            </p>
          ) : (
            <select
              value={policyId}
              onChange={(e) => setPolicyId(e.target.value)}
              className="mt-1 h-9 w-full rounded-md border border-hair-2 bg-card px-2.5 text-[14px] text-ink focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
            >
              <option value="">Select a policy…</option>
              {policies.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
        </label>
      ) : (
        <div className="text-[12px] text-ink-2">
          Fund by moving accounts into the trust
          {retitleEligible.length === 0 ? (
            <p className="mt-1 text-[12px] text-ink-3">No eligible accounts to move.</p>
          ) : (
            <div className="mt-1 divide-y divide-hair rounded-md border border-hair bg-card">
              {retitleEligible.map((a) => (
                <label
                  key={a.id}
                  className="flex cursor-pointer items-center gap-2 px-2.5 py-1.5 text-[13px] text-ink transition-colors hover:bg-card-hover"
                >
                  <input
                    type="checkbox"
                    checked={retitleIds.has(a.id)}
                    onChange={() => toggleRetitle(a.id)}
                    className="peer h-4 w-4 cursor-pointer appearance-none rounded border border-hair-2 bg-card-2 transition-colors hover:border-accent/60 checked:border-accent checked:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                  />
                  {a.name}
                </label>
              ))}
            </div>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={apply}
        className="h-9 rounded-md bg-accent px-3 text-[13px] text-white hover:bg-accent/90"
      >
        Add trust
      </button>
    </>
  );
}
