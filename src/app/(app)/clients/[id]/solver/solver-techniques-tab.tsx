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

/** Target probability-of-success a Roth-amount solve aims for by default. */
const DEFAULT_SOLVE_POS = 0.9;

interface EditorState {
  kind: TechniqueKind;
  /** undefined = add; otherwise the id of the technique being edited. */
  editId?: string;
}

interface Props {
  clientId: string;
  baseClientData: ClientData;
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
  onChange: (m: SolverMutation) => void;
  /** Wired by the workspace. Starts a goal-seek solve on a roth conversion's
   *  fixed amount. Optional so the component renders in isolation in tests. */
  onSolveStart?: (
    target: { kind: "roth-conversion-amount"; techniqueId: string },
    targetPoS: number,
  ) => void;
}

/** Quiet, non-interactive placeholder for an empty Base (read-only) column.
 *  Mirrors the add-tile's footprint so Base and Scenario columns stay aligned. */
function TechniqueEmpty({ label }: { label: string }) {
  return (
    <div className="col-span-2 flex items-center justify-center rounded-md border border-dashed border-hair px-3 py-2.5 text-[12px] text-ink-4">
      {label}
    </div>
  );
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
 * Side-aware list of technique rows. `SolverSection` renders its children
 * twice — once per column — exposing the active side via `useSolverSide()`.
 * The base column is read-only (or a quiet placeholder when empty); the working
 * column gets Edit / Remove per row and a trailing add-tile.
 */
function TechniqueGroup<T extends { id: string; name: string }>({
  base,
  working,
  summarize,
  onEdit,
  onRemove,
  onAdd,
  addLabel,
  emptyLabel,
  renderExtraAction,
}: {
  base: T[];
  working: T[];
  summarize: (t: T) => string;
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
  /** Opens the add form for this technique kind (Scenario column only). */
  onAdd: () => void;
  /** Noun for the add tile, e.g. "Roth conversion" → "Add Roth conversion". */
  addLabel: string;
  /** Placeholder when the Base column is empty, e.g. "No Roth conversions". */
  emptyLabel: string;
  /** Working-side-only per-row control (e.g. a Solve button). */
  renderExtraAction?: (t: T) => ReactNode;
}) {
  const side = useSolverSide();

  // Base column: read-only rows, or a quiet placeholder when empty.
  if (side === "base") {
    if (base.length === 0) return <TechniqueEmpty label={emptyLabel} />;
    return (
      <div className="col-span-2 space-y-2">
        {base.map((t) => (
          <SolverTechniqueRow key={t.id} name={t.name} summary={summarize(t)} />
        ))}
      </div>
    );
  }

  // Scenario column: editable rows followed by the add-tile (the add-tile is
  // the whole empty state when there are no working techniques).
  return (
    <div className="col-span-2 space-y-2">
      {working.map((t) => (
        <SolverTechniqueRow
          key={t.id}
          name={t.name}
          summary={summarize(t)}
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
  baseClientData,
  workingTree,
  accounts,
  liabilities,
  modelPortfolios,
  milestones,
  onChange,
  onSolveStart,
}: Props) {
  const [editor, setEditor] = useState<EditorState | null>(null);

  const close = () => setEditor(null);

  const baseRoth = baseClientData.rothConversions ?? [];
  const workingRoth = workingTree.rothConversions ?? [];
  const baseAsset = baseClientData.assetTransactions ?? [];
  const workingAsset = workingTree.assetTransactions ?? [];
  const baseReinv = baseClientData.reinvestments ?? [];
  const workingReinv = workingTree.reinvestments ?? [];

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
      <SolverSection title="Roth Conversions">
        <TechniqueGroup
          base={baseRoth}
          working={workingRoth}
          summarize={summarizeRothConversion}
          onEdit={(id) => setEditor({ kind: "roth", editId: id })}
          onRemove={(id) =>
            onChange({ kind: "roth-conversion-upsert", id, value: null })
          }
          onAdd={() => setEditor({ kind: "roth" })}
          addLabel="Roth conversion"
          emptyLabel="No Roth conversions"
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
          base={baseAsset}
          working={workingAsset}
          summarize={summarizeAssetTransaction}
          onEdit={(id) => setEditor({ kind: "asset", editId: id })}
          onRemove={(id) =>
            onChange({ kind: "asset-transaction-upsert", id, value: null })
          }
          onAdd={() => setEditor({ kind: "asset" })}
          addLabel="asset transaction"
          emptyLabel="No asset transactions"
        />
      </SolverSection>

      <SolverSection title="Reinvestments">
        <TechniqueGroup
          base={baseReinv}
          working={workingReinv}
          summarize={summarizeReinvestment}
          onEdit={(id) => setEditor({ kind: "reinvestment", editId: id })}
          onRemove={(id) =>
            onChange({ kind: "reinvestment-upsert", id, value: null })
          }
          onAdd={() => setEditor({ kind: "reinvestment" })}
          addLabel="reinvestment"
          emptyLabel="No reinvestments"
        />
      </SolverSection>

      {form}
    </div>
  );
}
