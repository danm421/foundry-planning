"use client";

// The Solver's "New trust" wizard: step bar, the current step, and a pinned
// footer. It owns the answers; on Review it builds one memoised batch for the
// impact projection and for "Add trust". Cancel emits nothing.

import { useMemo, useRef, useState } from "react";
import type { ClientData } from "@/engine/types";
import { crummeyBeneficiaryCount } from "@/lib/gifts/crummey-count";
import {
  defaultTrustName,
  guidedTrustContext,
  initialAnswers,
  stepBlocker,
  stepsFor,
  type GuidedStep,
  type GuidedTrustAnswers,
} from "@/lib/solver/guided-trust";
import {
  buildGuidedTrustBatch,
  buildGuidedTrustEntity,
  type GuidedTrustBatch,
} from "@/lib/solver/guided-trust-batch";
import type { SolverMutation, SolverSource } from "@/lib/solver/types";
import { GuidedTrustAccountsStep } from "./guided-trust-accounts-step";
import { GuidedTrustFundingStep } from "./guided-trust-funding-step";
import { GuidedTrustPeopleStep } from "./guided-trust-people-step";
import { GuidedTrustPowersStep } from "./guided-trust-powers-step";
import { GuidedTrustReviewStep } from "./guided-trust-review-step";
import { GuidedTrustSetupStep } from "./guided-trust-setup-step";
import { GuidedTrustTypeStep } from "./guided-trust-type-step";
import { StepBar } from "./guided-trust-ui";
import { useGuidedTrustImpact } from "./use-guided-trust-impact";

const STEP_NAME: Record<GuidedStep, string> = {
  type: "Type",
  people: "Who it's for",
  powers: "Powers",
  funding: "Funding",
  accounts: "Accounts",
  setup: "Setup",
  review: "Review",
};

const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60";

interface Props {
  clientId: string;
  source: SolverSource;
  mutations: SolverMutation[];
  tree: ClientData;
  annualExclusionByYear: Record<number, number>;
  onAdd: (batch: GuidedTrustBatch, answers: GuidedTrustAnswers) => void;
  onCancel: () => void;
}

export function GuidedTrustWizard({
  clientId,
  source,
  mutations,
  tree,
  annualExclusionByYear,
  onAdd,
  onCancel,
}: Props) {
  const [entityId] = useState(() => crypto.randomUUID());
  const [answers, setAnswers] = useState<GuidedTrustAnswers>(() => initialAnswers(entityId));
  const [step, setStep] = useState<GuidedStep>("type");
  const [remainderTouched, setRemainderTouched] = useState(false);
  const [editingFromReview, setEditingFromReview] = useState(false);

  const ctx = useMemo(() => guidedTrustContext(tree, annualExclusionByYear), [tree, annualExclusionByYear]);
  const steps = stepsFor(answers.kind);
  const index = Math.max(0, steps.indexOf(step));
  const stepHint = stepBlocker(step, answers, ctx);

  // buildGuidedTrustBatch mints ids: draw them from a per-wizard pool, restarting
  // at 0 each build, so an unchanged rebuild is byte-identical.
  const idPool = useRef<string[]>([]);
  const buildBatch = (a: GuidedTrustAnswers) => {
    let i = 0;
    return buildGuidedTrustBatch(a, tree, () => (idPool.current[i] ??= crypto.randomUUID(), idPool.current[i++]));
  };

  // The impact projection sees the batch as of the last Review render, keyed on
  // the answers WITHOUT the name, so typing a name or an Edit that changes
  // nothing never re-projects. Set during render (derived state), not in an effect.
  const [impactSeen, setImpactSeen] = useState<{ key: string; tree: ClientData; mutations: SolverMutation[] } | null>(null);
  if (step === "review") {
    const key = JSON.stringify({ ...answers, name: defaultTrustName(answers, tree) });
    if (!impactSeen || impactSeen.key !== key || impactSeen.tree !== tree) {
      setImpactSeen({ key, tree, mutations: buildBatch({ ...answers, name: defaultTrustName(answers, tree) }).mutations });
    }
  }
  const impact = useGuidedTrustImpact({
    clientId,
    source,
    mutations,
    tree,
    batch: impactSeen?.mutations ?? [],
    enabled: impactSeen != null,
  });

  // Add trust needs every step of this kind complete, not just the one shown.
  const reviewBlocker =
    step === "review"
      ? steps.map((s) => stepBlocker(s, answers, ctx)).find((h) => h != null) ?? null
      : null;

  function change(next: GuidedTrustAnswers) {
    if (next.kind !== answers.kind) {
      setRemainderTouched(false);
      setEditingFromReview(false);
    }
    setAnswers(next);
  }

  function goTo(target: GuidedStep) {
    // A blank name gets its default as the Review step opens.
    if (target === "review" && !answers.name.trim()) {
      setAnswers({ ...answers, name: defaultTrustName(answers, tree) });
    }
    setStep(target);
  }

  function next() {
    if (editingFromReview) {
      setEditingFromReview(false);
      return goTo("review");
    }
    goTo(steps[index + 1]);
  }

  function back() {
    setEditingFromReview(false);
    setStep(steps[index - 1]);
  }

  function edit(target: GuidedStep) {
    setEditingFromReview(true);
    setStep(target);
  }

  const isReview = step === "review";
  const blocker = isReview ? reviewBlocker : stepHint;
  const primaryLabel = isReview
    ? "Add trust"
    : editingFromReview
      ? "Back to review"
      : `Next: ${STEP_NAME[steps[index + 1]]} ›`;

  function renderStep() {
    switch (step) {
      case "type":
        return <GuidedTrustTypeStep answers={answers} ctx={ctx} onChange={change} />;
      case "people":
        return (
          <GuidedTrustPeopleStep
            answers={answers}
            ctx={ctx}
            onChange={change}
            remainderTouched={remainderTouched}
            onRemainderTouched={() => setRemainderTouched(true)}
          />
        );
      case "powers":
        return <GuidedTrustPowersStep answers={answers} ctx={ctx} onChange={change} />;
      case "funding": {
        const charityIds = new Set(
          (tree.externalBeneficiaries ?? []).filter((b) => b.kind === "charity").map((b) => b.id),
        );
        return (
          <GuidedTrustFundingStep
            trust={{
              id: entityId,
              name: answers.name || defaultTrustName(answers, tree),
              grantor: answers.grantor,
              crummeyPowers: answers.crummeyPowers,
              kind: answers.kind,
              crummeyHolders: crummeyBeneficiaryCount(buildGuidedTrustEntity(answers), {
                donor: answers.grantor,
                charityIds,
              }),
            }}
            items={answers.funding}
            onItemsChange={(funding) => change({ ...answers, funding })}
            ctx={ctx}
          />
        );
      }
      case "accounts":
        return <GuidedTrustAccountsStep answers={answers} ctx={ctx} onChange={change} />;
      case "setup":
        return <GuidedTrustSetupStep answers={answers} ctx={ctx} onChange={change} />;
      case "review":
        return (
          <GuidedTrustReviewStep
            answers={answers}
            ctx={ctx}
            onChange={change}
            onEdit={edit}
            impact={impact}
          />
        );
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="px-5 pt-4">
        <StepBar steps={steps.map((s) => STEP_NAME[s])} current={index} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-3">{renderStep()}</div>
      <div className="flex items-center justify-between gap-3 border-t border-hair px-5 py-2.5 text-[13px]">
        {index === 0 ? (
          <button
            type="button"
            onClick={onCancel}
            className={`rounded-[var(--radius-sm)] px-3.5 py-1.5 text-ink-3 hover:text-ink ${focusRing}`}
          >
            Cancel
          </button>
        ) : (
          <button
            type="button"
            onClick={back}
            className={`rounded-[var(--radius-sm)] px-3.5 py-1.5 text-ink-3 hover:text-ink ${focusRing}`}
          >
            ‹ Back
          </button>
        )}
        <div className="flex min-w-0 items-center gap-3">
          {blocker ? <span className="min-w-0 truncate text-[12px] text-ink-3">{blocker}</span> : null}
          <button
            type="button"
            disabled={blocker != null}
            onClick={isReview ? () => onAdd(buildBatch(answers), answers) : next}
            className={`shrink-0 rounded-[var(--radius-sm)] bg-accent px-3.5 py-1.5 font-medium text-accent-on disabled:opacity-40 ${focusRing}`}
          >
            {primaryLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
