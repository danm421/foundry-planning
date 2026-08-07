"use client";

import { RtqForm } from "@/components/risk/rtq-form";
import { RTQ_V1, type RtqAnswers } from "@/lib/risk/rtq";
import type { IntakeDraft } from "@/lib/intake/schema";

export interface RiskStepProps {
  value: IntakeDraft["risk"];
  onChange: (next: NonNullable<IntakeDraft["risk"]>) => void;
}

// ─── RiskStep ────────────────────────────────────────────────────────────────
//
// The Risk Tolerance Questionnaire as a wizard step, so an advisor can collect
// tolerance in the same form as everything else instead of sending a second
// link. Scored for the PRIMARY only — one form has one respondent, and asking
// someone to answer on their partner's behalf produces the worst kind of risk
// data. A spouse score still comes from the standalone RTQ link.
//
// `rtqVersion` is NOT stamped here. The submit route stamps it, so the version
// recorded is the one the answers were finally submitted under.

export function RiskStep({ value, onChange }: RiskStepProps) {
  const answers = (value?.answers ?? {}) as RtqAnswers;
  const note = value?.environmentNote ?? "";

  return (
    <div className="space-y-4">
      <p className="text-[14px] text-ink-2">
        There are no right answers. Your advisor uses these to calibrate how much
        market risk your plan should carry.
      </p>
      <RtqForm
        questions={RTQ_V1}
        showEnvironmentNote
        hideSubmit
        value={answers}
        note={note}
        onChange={(nextAnswers, nextNote) =>
          onChange({ answers: nextAnswers, environmentNote: nextNote || undefined })
        }
      />
    </div>
  );
}
