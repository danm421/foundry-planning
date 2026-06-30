"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import type {
  ClientData,
  RothConversion,
  AssetTransaction,
  Reinvestment,
  Relocation,
} from "@/engine/types";
import type { SolverMutation } from "@/lib/solver/types";
import type { ClientMilestones } from "@/lib/milestones";
import {
  summarizeRothConversion,
  summarizeAssetTransaction,
  summarizeReinvestment,
  summarizeRelocation,
} from "@/lib/solver/technique-summaries";
import {
  toRothConversionInitialData,
  toReinvestmentInitialData,
  toAssetTransactionInitialData,
  toRelocationInitialData,
} from "@/lib/solver/technique-form-data";
import AddRothConversionForm from "@/components/forms/add-roth-conversion-form";
import AddReinvestmentForm from "@/components/forms/add-reinvestment-form";
import AddAssetTransactionForm from "@/components/forms/add-asset-transaction-form";
import AddRelocationForm from "@/components/forms/add-relocation-form";
import { SolverSection } from "./solver-section";
import { SolverTechniqueRow } from "./solver-technique-row";

type TechniqueKind = "roth" | "asset" | "reinvestment" | "relocation";

/** Target probability-of-success a Roth-amount solve aims for by default. */
const DEFAULT_SOLVE_POS = 0.9;

interface EditorState {
  kind: TechniqueKind;
  /** undefined = add; otherwise the id of the technique being edited. */
  editId?: string;
}

interface Props {
  clientId: string;
  workingTree: ClientData;
  accounts: {
    id: string;
    name: string;
    category: string;
    subType: string;
    ownerFamilyMemberId?: string | null;
  }[];
  liabilities: {
    id: string;
    name: string;
    linkedPropertyId: string | null;
    balance: string;
  }[];
  modelPortfolios: { id: string; name: string; growthRate?: number }[];
  milestones?: ClientMilestones;
  /** Ids of techniques present in the base plan, by kind — used to tag rows
   *  "Base plan" vs "Added". Optional so the component renders in isolation. */
  baseTechniqueIds?: {
    roth: Set<string>;
    asset: Set<string>;
    reinvestment: Set<string>;
    relocation: Set<string>;
  };
  onChange: (m: SolverMutation) => void;
  /** Wired by the workspace. Starts a goal-seek solve on a roth conversion's
   *  fixed amount. Optional so the component renders in isolation in tests. */
  onSolveStart?: (
    target: { kind: "roth-conversion-amount"; techniqueId: string },
    targetPoS: number,
  ) => void;
}

/** Dashed "add" tile that lives in the Scenario (working) column — the affordance
 *  for adding a new technique, and the whole empty state when there are none. */
function TechniqueAddTile({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-hair-2 px-3 py-2.5 text-[12px] font-medium text-ink-3 transition-colors hover:border-accent/60 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
    >
      <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5">
        <path
          d="M8 3.5v9M3.5 8h9"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
      Add {label}
    </button>
  );
}

/**
 * Editable list of technique rows for the scenario surface. Each row gets
 * Edit / Remove and the group ends with a trailing add-tile (the add-tile is
 * also the whole empty state when there are no techniques yet).
 */
function TechniqueGroup<T extends { id: string; name: string; enabled?: boolean }>({
  working,
  baseIds,
  summarize,
  onEdit,
  onRemove,
  onToggle,
  onAdd,
  addLabel,
  renderExtraAction,
}: {
  working: T[];
  /** Base-plan technique ids for this kind; drives the origin badge. */
  baseIds?: Set<string>;
  summarize: (t: T) => string;
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
  /** Flips the technique's enabled state. */
  onToggle: (t: T) => void;
  /** Opens the add form for this technique kind. */
  onAdd: () => void;
  /** Noun for the add tile, e.g. "Roth conversion" → "Add Roth conversion". */
  addLabel: string;
  /** Per-row control (e.g. a Solve button). */
  renderExtraAction?: (t: T) => ReactNode;
}) {
  return (
    <div className="col-span-2 space-y-2">
      {working.map((t) => (
        <SolverTechniqueRow
          key={t.id}
          name={t.name}
          summary={summarize(t)}
          enabled={t.enabled !== false}
          onToggle={() => onToggle(t)}
          badge={baseIds ? (baseIds.has(t.id) ? "Base plan" : "Added") : undefined}
          onEdit={() => onEdit(t.id)}
          onRemove={() => onRemove(t.id)}
          extraAction={renderExtraAction?.(t)}
        />
      ))}
      <TechniqueAddTile label={addLabel} onClick={onAdd} />
    </div>
  );
}

export function SolverTechniquesTab({
  clientId,
  workingTree,
  accounts,
  liabilities,
  modelPortfolios,
  milestones,
  baseTechniqueIds,
  onChange,
  onSolveStart,
}: Props) {
  const [editor, setEditor] = useState<EditorState | null>(null);

  const close = () => setEditor(null);

  const workingRoth = workingTree.rothConversions ?? [];
  const workingAsset = workingTree.assetTransactions ?? [];
  const workingReinv = workingTree.reinvestments ?? [];
  const workingRelocations = workingTree.relocations ?? [];

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
          onChange({
            kind: "roth-conversion-upsert",
            id: t.id,
            value: { ...t, enabled: existing?.enabled },
          })
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
          onChange({
            kind: "reinvestment-upsert",
            id: t.id,
            value: { ...t, enabled: existing?.enabled },
          })
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
          onChange({
            kind: "asset-transaction-upsert",
            id: t.id,
            value: { ...t, enabled: existing?.enabled },
          })
        }
      />
    );
  } else if (editor?.kind === "relocation") {
    const existing: Relocation | undefined = editor.editId
      ? workingRelocations.find((t) => t.id === editor.editId)
      : undefined;
    form = (
      <AddRelocationForm
        clientId={clientId}
        initialData={existing ? toRelocationInitialData(existing) : undefined}
        onClose={close}
        onSaved={close}
        onSubmitDraft={(t) =>
          onChange({
            kind: "relocation-upsert",
            id: t.id,
            value: { ...t, enabled: existing?.enabled },
          })
        }
      />
    );
  }

  return (
    <div>
      <SolverSection title="Roth Conversions">
        <TechniqueGroup
          working={workingRoth}
          baseIds={baseTechniqueIds?.roth}
          summarize={summarizeRothConversion}
          onEdit={(id) => setEditor({ kind: "roth", editId: id })}
          onRemove={(id) =>
            onChange({ kind: "roth-conversion-upsert", id, value: null })
          }
          onToggle={(t) =>
            onChange({
              kind: "roth-conversion-upsert",
              id: t.id,
              value: { ...t, enabled: t.enabled === false ? undefined : false },
            })
          }
          onAdd={() => setEditor({ kind: "roth" })}
          addLabel="Roth conversion"
          renderExtraAction={(rc) =>
            onSolveStart && rc.conversionType === "fixed_amount" ? (
              <button
                type="button"
                onClick={() =>
                  onSolveStart(
                    { kind: "roth-conversion-amount", techniqueId: rc.id },
                    DEFAULT_SOLVE_POS,
                  )
                }
                className="rounded-md border border-hair-2 px-2 py-1 text-[12px] text-accent hover:border-accent/60"
              >
                Solve
              </button>
            ) : null
          }
        />
      </SolverSection>

      <SolverSection title="Asset Transactions">
        <TechniqueGroup
          working={workingAsset}
          baseIds={baseTechniqueIds?.asset}
          summarize={summarizeAssetTransaction}
          onEdit={(id) => setEditor({ kind: "asset", editId: id })}
          onRemove={(id) =>
            onChange({ kind: "asset-transaction-upsert", id, value: null })
          }
          onToggle={(t) =>
            onChange({
              kind: "asset-transaction-upsert",
              id: t.id,
              value: { ...t, enabled: t.enabled === false ? undefined : false },
            })
          }
          onAdd={() => setEditor({ kind: "asset" })}
          addLabel="asset transaction"
        />
      </SolverSection>

      <SolverSection title="Reinvestments">
        <TechniqueGroup
          working={workingReinv}
          baseIds={baseTechniqueIds?.reinvestment}
          summarize={summarizeReinvestment}
          onEdit={(id) => setEditor({ kind: "reinvestment", editId: id })}
          onRemove={(id) =>
            onChange({ kind: "reinvestment-upsert", id, value: null })
          }
          onToggle={(t) =>
            onChange({
              kind: "reinvestment-upsert",
              id: t.id,
              value: { ...t, enabled: t.enabled === false ? undefined : false },
            })
          }
          onAdd={() => setEditor({ kind: "reinvestment" })}
          addLabel="reinvestment"
        />
      </SolverSection>

      <SolverSection title="Relocation">
        <TechniqueGroup
          working={workingRelocations}
          baseIds={baseTechniqueIds?.relocation}
          summarize={summarizeRelocation}
          onEdit={(id) => setEditor({ kind: "relocation", editId: id })}
          onRemove={(id) =>
            onChange({ kind: "relocation-upsert", id, value: null })
          }
          onToggle={(t) =>
            onChange({
              kind: "relocation-upsert",
              id: t.id,
              value: { ...t, enabled: t.enabled === false ? undefined : false },
            })
          }
          onAdd={() => setEditor({ kind: "relocation" })}
          addLabel="relocation"
        />
      </SolverSection>

      {form}
    </div>
  );
}
