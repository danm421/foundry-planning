"use client";

// Wizard step for a CRT or CLT: the split-interest form (grantor, payout, term,
// charity, funding accounts) plus, for a CLT, who gets what's left when the
// term ends. The body scrolls inside the fixed dialog height. Nothing is
// emitted here; the answers are applied by the wizard's Add trust.

import { useCallback } from "react";
import {
  evenShares,
  stepBlocker,
  trustPeopleOptions,
  type GuidedTrustAnswers,
  type GuidedTrustContext,
  type PersonShare,
  type SplitInterestAnswers,
} from "@/lib/solver/guided-trust";
import { GuidedTrustPeoplePicker } from "./guided-trust-people-picker";
import { StepHeader } from "./guided-trust-ui";
import { SolverSplitInterestForm } from "./solver-split-interest-form";

interface Props {
  answers: GuidedTrustAnswers;
  ctx: GuidedTrustContext;
  onChange: (next: GuidedTrustAnswers) => void;
}

const isHousehold = (s: PersonShare, role: "client" | "spouse") =>
  s.person.kind === "household" && s.person.role === role;

export function GuidedTrustSetupStep({ answers, ctx, onChange }: Props) {
  const subType = answers.kind === "clt" ? "clt" : "crt";

  const setSplit = useCallback(
    (splitInterest: SplitInterestAnswers | null) => {
      if (JSON.stringify(splitInterest) === JSON.stringify(answers.splitInterest)) return;
      onChange({ ...answers, splitInterest });
    },
    [answers, onChange],
  );

  function setGrantor(grantor: "client" | "spouse") {
    if (grantor === answers.grantor) return;
    // The new grantor can't also receive what's left.
    const kept = answers.remainder.filter((s) => !isHousehold(s, grantor));
    onChange({
      ...answers,
      grantor,
      remainder: kept.length === answers.remainder.length ? answers.remainder : evenShares(kept.map((s) => s.person)),
    });
  }

  const blocked = stepBlocker("setup", answers, ctx);

  return (
    <div className="max-h-[56vh] overflow-y-auto pr-1">
      <StepHeader
        title="Set up the trust"
        subtitle={
          subType === "crt"
            ? "Who gives, what it pays, for how long, and which charity gets the rest."
            : "Who gives, what the charity is paid, for how long, and who gets the rest."
        }
      />
      <SolverSplitInterestForm
        clientData={ctx.tree}
        subType={subType}
        isMarried={ctx.isMarried}
        grantor={answers.grantor}
        onGrantorChange={setGrantor}
        value={answers.splitInterest}
        onChange={(next) => setSplit(next)}
      />
      {subType === "clt" ? (
        <div className="mt-3">
          <GuidedTrustPeoplePicker
            label="Gets what's left"
            note="who receives the trust when it ends. This is who the 'to heirs' figures credit."
            options={trustPeopleOptions(ctx.tree, answers.grantor, "remainder")}
            value={answers.remainder}
            onChange={(remainder) => onChange({ ...answers, remainder })}
          />
        </div>
      ) : null}
      {blocked && answers.splitInterest ? (
        <p role="status" className="mt-2 text-[12px] text-ink-3">
          {blocked}
        </p>
      ) : null}
    </div>
  );
}
