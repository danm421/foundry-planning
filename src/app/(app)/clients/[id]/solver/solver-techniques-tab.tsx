"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import type {
  ClientData,
  RothConversion,
  AssetTransaction,
  Reinvestment,
} from "@/engine/types";
import type { SolverMutation } from "@/lib/solver/types";
import type { ClientMilestones } from "@/lib/milestones";
import {
  summarizeRothConversion,
  summarizeAssetTransaction,
  summarizeReinvestment,
} from "@/lib/solver/technique-summaries";
import {
  toRothConversionInitialData,
  toReinvestmentInitialData,
  toAssetTransactionInitialData,
} from "@/lib/solver/technique-form-data";
import AddRothConversionForm from "@/components/forms/add-roth-conversion-form";
import AddReinvestmentForm from "@/components/forms/add-reinvestment-form";
import AddAssetTransactionForm from "@/components/forms/add-asset-transaction-form";
import { SolverSection, useSolverSide } from "./solver-section";
import { SolverTechniqueRow } from "./solver-technique-row";

type TechniqueKind = "roth" | "asset" | "reinvestment";

interface EditorState {
  kind: TechniqueKind;
  /** undefined = add; otherwise the id of the technique being edited. */
  editId?: string;
}

interface Props {
  clientId: string;
  baseClientData: ClientData;
  workingTree: ClientData;
  accounts: { id: string; name: string; category: string; subType: string }[];
  liabilities: {
    id: string;
    name: string;
    linkedPropertyId: string | null;
    balance: string;
  }[];
  modelPortfolios: { id: string; name: string }[];
  milestones?: ClientMilestones;
  onChange: (m: SolverMutation) => void;
}

/**
 * Side-aware list of technique rows. `SolverSection` renders its children
 * twice — once per column — exposing the active side via `useSolverSide()`.
 * The base column is read-only; the working column gets Edit / Remove.
 */
function TechniqueGroup<T extends { id: string; name: string }>({
  base,
  working,
  summarize,
  onEdit,
  onRemove,
}: {
  base: T[];
  working: T[];
  summarize: (t: T) => string;
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const side = useSolverSide();
  const rows = side === "base" ? base : working;

  if (rows.length === 0) {
    return (
      <div className="col-span-2 text-[12px] text-ink-4">None</div>
    );
  }

  return (
    <div className="col-span-2 space-y-2">
      {rows.map((t) =>
        side === "base" ? (
          <SolverTechniqueRow key={t.id} name={t.name} summary={summarize(t)} />
        ) : (
          <SolverTechniqueRow
            key={t.id}
            name={t.name}
            summary={summarize(t)}
            onEdit={() => onEdit(t.id)}
            onRemove={() => onRemove(t.id)}
          />
        ),
      )}
    </div>
  );
}

export function SolverTechniquesTab({
  clientId,
  baseClientData,
  workingTree,
  accounts,
  liabilities,
  modelPortfolios,
  milestones,
  onChange,
}: Props) {
  const [editor, setEditor] = useState<EditorState | null>(null);

  const close = () => setEditor(null);

  const baseRoth = baseClientData.rothConversions ?? [];
  const workingRoth = workingTree.rothConversions ?? [];
  const baseAsset = baseClientData.assetTransactions ?? [];
  const workingAsset = workingTree.assetTransactions ?? [];
  const baseReinv = baseClientData.reinvestments ?? [];
  const workingReinv = workingTree.reinvestments ?? [];

  function addButton(kind: TechniqueKind, label: string): ReactNode {
    return (
      <button
        type="button"
        onClick={() => setEditor({ kind })}
        className="rounded-md border border-dashed border-hair-2 px-2.5 py-1 text-[11px] font-medium text-ink-3 normal-case tracking-normal hover:border-accent/60 hover:text-ink"
      >
        + Add {label}
      </button>
    );
  }

  // Active editor form.
  let form: ReactNode = null;
  if (editor?.kind === "roth") {
    const existing: RothConversion | undefined = editor.editId
      ? workingRoth.find((r) => r.id === editor.editId)
      : undefined;
    form = (
      <AddRothConversionForm
        clientId={clientId}
        accounts={accounts}
        milestones={milestones}
        initialData={
          existing ? toRothConversionInitialData(existing) : undefined
        }
        onClose={close}
        onSaved={close}
        onSubmitDraft={(t) =>
          onChange({ kind: "roth-conversion-upsert", id: t.id, value: t })
        }
      />
    );
  } else if (editor?.kind === "reinvestment") {
    const existing: Reinvestment | undefined = editor.editId
      ? workingReinv.find((r) => r.id === editor.editId)
      : undefined;
    form = (
      <AddReinvestmentForm
        clientId={clientId}
        accounts={accounts}
        modelPortfolios={modelPortfolios}
        milestones={milestones}
        initialData={
          existing ? toReinvestmentInitialData(existing) : undefined
        }
        onClose={close}
        onSaved={close}
        onSubmitDraft={(t) =>
          onChange({ kind: "reinvestment-upsert", id: t.id, value: t })
        }
      />
    );
  } else if (editor?.kind === "asset") {
    const existing: AssetTransaction | undefined = editor.editId
      ? workingAsset.find((t) => t.id === editor.editId)
      : undefined;
    form = (
      <AddAssetTransactionForm
        clientId={clientId}
        accounts={accounts}
        liabilities={liabilities}
        milestones={milestones}
        initialData={
          existing ? toAssetTransactionInitialData(existing) : undefined
        }
        onClose={close}
        onSaved={close}
        onSubmitDraft={(t) =>
          onChange({ kind: "asset-transaction-upsert", id: t.id, value: t })
        }
      />
    );
  }

  return (
    <div>
      <SolverSection
        title="Roth Conversions"
        action={addButton("roth", "Roth conversion")}
      >
        <TechniqueGroup
          base={baseRoth}
          working={workingRoth}
          summarize={summarizeRothConversion}
          onEdit={(id) => setEditor({ kind: "roth", editId: id })}
          onRemove={(id) =>
            onChange({ kind: "roth-conversion-upsert", id, value: null })
          }
        />
      </SolverSection>

      <SolverSection
        title="Asset Transactions"
        action={addButton("asset", "asset transaction")}
      >
        <TechniqueGroup
          base={baseAsset}
          working={workingAsset}
          summarize={summarizeAssetTransaction}
          onEdit={(id) => setEditor({ kind: "asset", editId: id })}
          onRemove={(id) =>
            onChange({ kind: "asset-transaction-upsert", id, value: null })
          }
        />
      </SolverSection>

      <SolverSection
        title="Reinvestments"
        action={addButton("reinvestment", "reinvestment")}
      >
        <TechniqueGroup
          base={baseReinv}
          working={workingReinv}
          summarize={summarizeReinvestment}
          onEdit={(id) => setEditor({ kind: "reinvestment", editId: id })}
          onRemove={(id) =>
            onChange({ kind: "reinvestment-upsert", id, value: null })
          }
        />
      </SolverSection>

      {form}
    </div>
  );
}
