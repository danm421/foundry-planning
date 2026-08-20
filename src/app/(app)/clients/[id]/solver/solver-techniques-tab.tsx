"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import type {
  Account,
  ClientData,
  RothConversion,
  AssetTransaction,
  Reinvestment,
  Relocation,
} from "@/engine/types";
import type { SolverMutation } from "@/lib/solver/types";
import type { AccountAssetMix } from "@/engine/monteCarlo/trial";
import type { ClientMilestones } from "@/lib/milestones";
import type { EstateFlowGift } from "@/lib/estate/estate-flow-gifts";
import { controllingFamilyMember } from "@/engine/ownership";
import { flipEnabled, isEnabled } from "@/lib/solver/technique-enabled";
import {
  summarizeRothConversion,
  summarizeAssetTransaction,
  summarizeReinvestment,
  summarizeRelocation,
} from "@/lib/solver/technique-summaries";
import {
  previewDebtPaydown,
  resolveDebtPaydowns,
  summarizeDebtPaydown,
} from "@/lib/solver/debt-paydown";
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
import DebtPaydownDialog from "@/components/forms/debt-paydown-dialog";
import { SolverSection } from "./solver-section";
import { SolverTechniqueRow } from "./solver-technique-row";
import { SolverTechniqueCard } from "./solver-technique-card";
import { SolverEstateTechnique } from "./solver-estate-technique";
import {
  RothConversionIcon,
  AssetTransactionIcon,
  ReinvestmentIcon,
  RelocationIcon,
  DebtPaydownIcon,
  EstatePlanningIcon,
} from "./solver-technique-icons";

type TechniqueKind = "roth" | "asset" | "reinvestment" | "relocation" | "debt" | "estate";

/** Target probability-of-success a Roth-amount solve aims for by default. */
const DEFAULT_SOLVE_POS = 0.9;

/**
 * The technique catalog, rendered as the card grid. A card stays put after use
 * — a scenario can hold several conversions, sales, or paydowns — so the grid
 * is a permanent palette rather than an empty state that disappears.
 */
const CATALOG: {
  kind: TechniqueKind;
  label: string;
  /** Compact form for the row list, where the summary competes for a ~230px
   *  line — "Roth · $25,000/yr · 2030–2035" fits where the full noun doesn't. */
  rowLabel: string;
  blurb: string;
  Icon: (props: { className?: string }) => ReactNode;
}[] = [
  {
    kind: "roth",
    label: "Roth conversion",
    rowLabel: "Roth",
    blurb: "Move pre-tax savings into a Roth",
    Icon: RothConversionIcon,
  },
  {
    kind: "asset",
    label: "Asset transaction",
    rowLabel: "Asset",
    blurb: "Buy or sell an asset",
    Icon: AssetTransactionIcon,
  },
  {
    kind: "reinvestment",
    label: "Reinvestment",
    rowLabel: "Reinvest",
    blurb: "Put sale proceeds into a portfolio",
    Icon: ReinvestmentIcon,
  },
  {
    kind: "relocation",
    label: "Relocation",
    rowLabel: "Relocation",
    blurb: "Move to a new state",
    Icon: RelocationIcon,
  },
  {
    kind: "debt",
    label: "Debt paydown",
    rowLabel: "Debt",
    blurb: "Pay a loan off sooner",
    Icon: DebtPaydownIcon,
  },
  {
    kind: "estate",
    label: "Estate planning",
    rowLabel: "Estate",
    blurb: "Trusts, gifts, and charities",
    Icon: EstatePlanningIcon,
  },
];

/** Kind → its card entry, for the label/glyph a mixed row list needs. Total by
 *  construction: CATALOG covers every TechniqueKind. */
const BY_KIND = Object.fromEntries(CATALOG.map((c) => [c.kind, c])) as Record<
  TechniqueKind,
  (typeof CATALOG)[number]
>;

interface EditorState {
  kind: TechniqueKind;
  /** undefined = add; otherwise the id of the technique being edited. */
  editId?: string;
}

/** One line in the scenario's technique list, flattened across every kind. */
interface TechniqueRowData {
  key: string;
  kind: TechniqueKind;
  name: string;
  summary: string;
  enabled: boolean;
  badge?: "Base plan" | "Added";
  onEdit: () => void;
  onRemove: () => void;
  onToggle: () => void;
  extraAction?: ReactNode;
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
  modelPortfolios: { id: string; name: string; growthRate?: number; mix?: AccountAssetMix[] }[];
  milestones?: ClientMilestones;
  /** Household members eligible to own an inline-created Roth IRA. Optional —
   *  when absent (or empty), the inline creation panel stays disabled. */
  owners?: { familyMemberId: string; label: string }[];
  /** Default growth rate for a newly created retirement account. */
  retirementGrowthDefault?: number;
  /** MC asset mix of the retirement category default (the "Plan default" growth
   *  option). Empty/absent when that default is a custom/inflation rate. */
  retirementDefaultMix?: AccountAssetMix[];
  /** Resolved inflation rate, offered as a growth-rate option for the new account. */
  resolvedInflationRate?: number;
  /** Registers an inline-created draft account's MC asset mix (keyed by account
   *  id) so its dollars are randomized in Monte Carlo. No-op when the mix is
   *  empty (custom/inflation growth). Optional so the tab renders in isolation. */
  onRegisterAccountMix?: (accountId: string, mix: AccountAssetMix[]) => void;
  /** Ids of techniques present in the base plan, by kind — used to tag rows
   *  "Base plan" vs "Added". Optional so the component renders in isolation. */
  baseTechniqueIds?: {
    roth: Set<string>;
    asset: Set<string>;
    reinvestment: Set<string>;
    relocation: Set<string>;
  };
  /** The live mutation set. Debt paydowns are stored as mutations rather than
   *  engine entities (they lower to a liability's extraPayments), so the tab
   *  reads their current specs back from here. Optional so the tab still
   *  renders in isolation. */
  mutations?: SolverMutation[];
  onChange: (m: SolverMutation) => void;
  /** Wired by the workspace. Starts a goal-seek solve on a roth conversion's
   *  fixed amount. Optional so the component renders in isolation in tests. */
  onSolveStart?: (
    target: { kind: "roth-conversion-amount"; techniqueId: string },
    targetPoS: number,
  ) => void;
  /** Base facts + base-plan gifts for the estate technique. Optional so the
   *  component still renders in isolation (tests, storybook). When absent the
   *  Estate Planning card is hidden. */
  baseClientData?: ClientData;
  baseGifts?: EstateFlowGift[];
  /** Forwarded to the estate technique's onOpen — the workspace uses it to
   *  switch the right pane to the Estate report. */
  onEstateOpen?: () => void;
}

/** "Base plan" vs "Added" — only when the caller supplied base ids for the kind. */
function badgeFor(baseIds: Set<string> | undefined, id: string) {
  if (!baseIds) return undefined;
  return baseIds.has(id) ? ("Base plan" as const) : ("Added" as const);
}

export function SolverTechniquesTab({
  clientId,
  workingTree,
  accounts,
  liabilities,
  modelPortfolios,
  milestones,
  owners,
  retirementGrowthDefault,
  retirementDefaultMix,
  resolvedInflationRate,
  onRegisterAccountMix,
  baseTechniqueIds,
  mutations,
  onChange,
  onSolveStart,
  baseClientData,
  baseGifts,
  onEstateOpen,
}: Props) {
  const [editor, setEditor] = useState<EditorState | null>(null);

  const close = () => setEditor(null);

  const reinvestmentPortfolioGrowth = useMemo(
    () =>
      new Map(
        modelPortfolios
          .filter((p): p is { id: string; name: string; growthRate: number } => p.growthRate != null)
          .map((p) => [p.id, p.growthRate]),
      ),
    [modelPortfolios],
  );

  // A paydown lowers to a liability's `extraPayments`, so one that arrives from
  // a sourced scenario has no mutation behind it — resolveDebtPaydowns reads
  // those back off the tree and overlays this session's edits on top.
  const workingLiabilities = useMemo(() => workingTree.liabilities ?? [], [workingTree.liabilities]);
  const debtPaydownRows = useMemo(
    () =>
      [...resolveDebtPaydowns(workingLiabilities, mutations ?? []).entries()].flatMap(
        ([liabilityId, row]) => {
          const liability = workingLiabilities.find((l) => l.id === liabilityId);
          return liability
            ? [{ id: liabilityId, name: liability.name, row, liability }]
            : [];
        },
      ),
    [workingLiabilities, mutations],
  );

  const workingRoth = workingTree.rothConversions ?? [];
  const workingAsset = workingTree.assetTransactions ?? [];
  const workingReinv = workingTree.reinvestments ?? [];
  const workingReloc = workingTree.relocations ?? [];

  // The `accounts` prop is base-sourced. Accounts created inline as solver
  // drafts (e.g. a Roth IRA added from the Roth-conversion dialog) live only as
  // account-upsert mutations in the working tree, not in base client data.
  // Merge those drafts in so a technique that targets one still resolves it
  // when its dialog is re-opened to edit — otherwise the destination looks
  // missing and the form forces a re-create.
  const accountsWithDrafts = useMemo(() => {
    const baseIds = new Set(accounts.map((a) => a.id));
    const drafts = (workingTree.accounts ?? [])
      .filter((a) => !baseIds.has(a.id))
      .map((a) => ({
        id: a.id,
        name: a.name,
        category: a.category,
        subType: a.subType ?? "",
        ownerFamilyMemberId: controllingFamilyMember(a) ?? null,
      }));
    return drafts.length ? [...accounts, ...drafts] : accounts;
  }, [accounts, workingTree.accounts]);

  const rothAccountCreation =
    owners && owners.length > 0 && retirementGrowthDefault != null && resolvedInflationRate != null
      ? {
          owners,
          modelPortfolios: modelPortfolios.map((p) => ({
            id: p.id,
            name: p.name,
            growthRate: p.growthRate ?? 0,
            mix: p.mix ?? [],
          })),
          retirementGrowthDefault,
          retirementDefaultMix: retirementDefaultMix ?? [],
          resolvedInflationRate,
          onCreate: (account: Account, mix: AccountAssetMix[]) => {
            onChange({ kind: "account-upsert", id: account.id, value: account });
            // Only register a mix for randomized sources; custom/inflation stay
            // deterministic (empty mix) and must not enter extraAccountMixes.
            if (mix.length > 0) onRegisterAccountMix?.(account.id, mix);
          },
        }
      : undefined;

  // Every configured technique as one flat list — the tab no longer groups by
  // kind, so each row carries its own kind label and glyph.
  const rows: TechniqueRowData[] = [
    ...workingRoth.map((t) => ({
      key: `roth:${t.id}`,
      kind: "roth" as const,
      name: t.name,
      summary: summarizeRothConversion(t),
      enabled: isEnabled(t),
      badge: badgeFor(baseTechniqueIds?.roth, t.id),
      onEdit: () => setEditor({ kind: "roth", editId: t.id }),
      onRemove: () => onChange({ kind: "roth-conversion-upsert", id: t.id, value: null }),
      onToggle: () =>
        onChange({
          kind: "roth-conversion-upsert",
          id: t.id,
          value: flipEnabled(t),
        }),
      extraAction:
        onSolveStart && t.conversionType === "fixed_amount" ? (
          <button
            type="button"
            onClick={() =>
              onSolveStart({ kind: "roth-conversion-amount", techniqueId: t.id }, DEFAULT_SOLVE_POS)
            }
            className="rounded-md border border-hair-2 px-2 py-1 text-[12px] text-accent hover:border-accent/60"
          >
            Solve
          </button>
        ) : undefined,
    })),
    ...workingAsset.map((t) => ({
      key: `asset:${t.id}`,
      kind: "asset" as const,
      name: t.name,
      summary: summarizeAssetTransaction(t),
      enabled: isEnabled(t),
      badge: badgeFor(baseTechniqueIds?.asset, t.id),
      onEdit: () => setEditor({ kind: "asset", editId: t.id }),
      onRemove: () => onChange({ kind: "asset-transaction-upsert", id: t.id, value: null }),
      onToggle: () =>
        onChange({
          kind: "asset-transaction-upsert",
          id: t.id,
          value: flipEnabled(t),
        }),
    })),
    ...workingReinv.map((t) => ({
      key: `reinvestment:${t.id}`,
      kind: "reinvestment" as const,
      name: t.name,
      summary: summarizeReinvestment(t, reinvestmentPortfolioGrowth),
      enabled: isEnabled(t),
      badge: badgeFor(baseTechniqueIds?.reinvestment, t.id),
      onEdit: () => setEditor({ kind: "reinvestment", editId: t.id }),
      onRemove: () => onChange({ kind: "reinvestment-upsert", id: t.id, value: null }),
      onToggle: () =>
        onChange({
          kind: "reinvestment-upsert",
          id: t.id,
          value: flipEnabled(t),
        }),
    })),
    ...workingReloc.map((t) => ({
      key: `relocation:${t.id}`,
      kind: "relocation" as const,
      name: t.name,
      summary: summarizeRelocation(t),
      enabled: isEnabled(t),
      badge: badgeFor(baseTechniqueIds?.relocation, t.id),
      onEdit: () => setEditor({ kind: "relocation", editId: t.id }),
      onRemove: () => onChange({ kind: "relocation-upsert", id: t.id, value: null }),
      onToggle: () =>
        onChange({
          kind: "relocation-upsert",
          id: t.id,
          value: flipEnabled(t),
        }),
    })),
    ...debtPaydownRows.map((t) => ({
      key: `debt:${t.id}`,
      kind: "debt" as const,
      name: t.name,
      summary: summarizeDebtPaydown(t.row, previewDebtPaydown(t.liability, t.row)),
      enabled: isEnabled(t.row),
      onEdit: () => setEditor({ kind: "debt" }),
      onRemove: () => onChange({ kind: "debt-paydown", liabilityId: t.id, value: null }),
      onToggle: () =>
        onChange({
          kind: "debt-paydown",
          liabilityId: t.id,
          value: flipEnabled(t.row),
        }),
    })),
  ];

  // Techniques in use float to the top; switched-off ones sink, dimmed. Sort is
  // stable, so a row only moves when its own switch is flipped.
  const orderedRows = [...rows].sort((a, b) => Number(!a.enabled) - Number(!b.enabled));

  const countByKind: Partial<Record<TechniqueKind, number>> = {};
  for (const r of rows) countByKind[r.kind] = (countByKind[r.kind] ?? 0) + 1;

  const openAdd = (kind: TechniqueKind) => {
    // The estate editor drives the right pane's Estate report.
    if (kind === "estate") onEstateOpen?.();
    setEditor({ kind });
  };

  // Active editor form. Estate planning has no arm here on purpose — it
  // renders its own dialog from the row list above, driven by `editor`.
  let form: ReactNode = null;
  if (editor?.kind === "roth") {
    const existing: RothConversion | undefined = editor.editId
      ? workingRoth.find((r) => r.id === editor.editId)
      : undefined;
    form = (
      <AddRothConversionForm
        clientId={clientId}
        accounts={accountsWithDrafts}
        milestones={milestones}
        rothAccountCreation={rothAccountCreation}
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
        accounts={accountsWithDrafts}
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
        accounts={accountsWithDrafts}
        liabilities={liabilities}
        milestones={milestones}
        existingNames={workingAsset.map((t) => t.name)}
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
  } else if (editor?.kind === "debt") {
    form = (
      <DebtPaydownDialog
        liabilities={workingLiabilities}
        rows={Object.fromEntries(debtPaydownRows.map((t) => [t.id, t.row]))}
        minYear={workingTree.planSettings.planStartYear}
        onClose={close}
        onSubmit={(changes) => {
          for (const c of changes) {
            onChange({ kind: "debt-paydown", liabilityId: c.liabilityId, value: c.value });
          }
        }}
      />
    );
  } else if (editor?.kind === "relocation") {
    const existing: Relocation | undefined = editor.editId
      ? workingReloc.find((t) => t.id === editor.editId)
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
      {/* The scenario's techniques, above the catalog. `empty:hidden` collapses
          the padding when there are no rows AND the estate technique renders
          nothing — so keep this wrapper free of always-rendered children. */}
      <div className="flex flex-col gap-2 px-5 py-4 empty:hidden">
        {orderedRows.map((r) => {
          const { rowLabel, Icon } = BY_KIND[r.kind];
          return (
            <SolverTechniqueRow
              key={r.key}
              name={r.name}
              summary={r.summary}
              kindLabel={rowLabel}
              icon={<Icon className="h-3.5 w-3.5" />}
              enabled={r.enabled}
              onToggle={r.onToggle}
              badge={r.badge}
              onEdit={r.onEdit}
              onRemove={r.onRemove}
              extraAction={r.extraAction}
            />
          );
        })}
        {baseClientData ? (
          <SolverEstateTechnique
            baseClientData={baseClientData}
            clientData={workingTree}
            baseGifts={baseGifts ?? []}
            onChange={onChange}
            hideWhenUnconfigured
            open={editor?.kind === "estate"}
            // Both ways in — this row's Edit and the catalog card — land here,
            // so the right-pane swing is wired once.
            onOpenChange={(o) => (o ? openAdd("estate") : setEditor(null))}
          />
        ) : null}
      </div>

      <SolverSection title="Add a technique">
        <div className="grid grid-cols-2 gap-2 xl:grid-cols-3">
          {CATALOG.filter((c) => c.kind !== "estate" || baseClientData).map(
            ({ kind, label, blurb, Icon }) => (
              <SolverTechniqueCard
                key={kind}
                label={label}
                blurb={blurb}
                count={countByKind[kind]}
                icon={<Icon className="h-4 w-4" />}
                onClick={() => openAdd(kind)}
              />
            ),
          )}
        </div>
      </SolverSection>

      {form}
    </div>
  );
}
