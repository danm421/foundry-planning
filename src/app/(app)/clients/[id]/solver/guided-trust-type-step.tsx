"use client";

// Wizard step 1: what kind of trust. Picking a row applies that kind's preset
// (`applyKindPreset`), which fills in later answers the advisor can still change.

import {
  applyKindPreset,
  type GuidedTrustAnswers,
  type GuidedTrustContext,
  type GuidedTrustKind,
} from "@/lib/solver/guided-trust";
import { ChoiceRow, GroupLabel, StepHeader } from "./guided-trust-ui";

interface Props {
  answers: GuidedTrustAnswers;
  ctx: GuidedTrustContext;
  onChange: (next: GuidedTrustAnswers) => void;
}

interface Row {
  kind: GuidedTrustKind;
  name: string;
  tag?: string;
  note: string;
  marriedOnly?: boolean;
}

const GROUPS: { label: string; rows: Row[] }[] = [
  {
    label: "Avoid probate",
    rows: [
      {
        kind: "revocable",
        name: "Revocable living trust",
        tag: "no tax change",
        note: "Accounts skip probate. You keep full control, and they stay in your taxable estate.",
      },
    ],
  },
  {
    label: "Move wealth out of the estate",
    rows: [
      {
        kind: "irrevocable",
        name: "Irrevocable gift trust",
        tag: "removes growth",
        note: "What you give leaves your estate. It uses lifetime exemption, so the saving is on everything it earns afterward.",
      },
      {
        kind: "slat",
        name: "SLAT · spousal access",
        tag: "removes growth",
        note: "Same, but your spouse can still take distributions, so the couple keeps indirect access.",
        marriedOnly: true,
      },
      {
        kind: "ilit",
        name: "ILIT · life insurance",
        tag: "removes death benefit",
        note: "The policy payout reaches heirs outside your taxable estate. An existing policy you transfer must stay out three years to count.",
      },
      {
        kind: "idgt",
        name: "IDGT · sale for a note",
        tag: "freezes value",
        note: "Sell assets to the trust for a note. Growth above the note's interest rate leaves your estate.",
      },
    ],
  },
  {
    label: "Charitable",
    rows: [
      {
        kind: "crt",
        name: "CRT · you get income, charity gets the rest",
        note: "You receive a yearly payout for life or a term; a charity gets what's left. Income-tax deduction now.",
      },
      {
        kind: "clt",
        name: "CLT · charity gets income, heirs get the rest",
        note: "A charity receives a yearly payout for a term; your heirs get what's left, at a reduced taxable gift.",
      },
    ],
  },
];

export function GuidedTrustTypeStep({ answers, ctx, onChange }: Props) {
  return (
    <div>
      <StepHeader title="What kind of trust?" />
      <div role="radiogroup" aria-label="What kind of trust?">
        {GROUPS.map((g) => (
          <div key={g.label}>
            <GroupLabel>{g.label}</GroupLabel>
            {g.rows
              .filter((r) => !r.marriedOnly || ctx.isMarried)
              .map((r) => (
                <ChoiceRow
                  key={r.kind}
                  name={r.name}
                  tag={r.tag}
                  description={r.note}
                  checked={answers.kind === r.kind}
                  onSelect={() => onChange(applyKindPreset(answers, r.kind, ctx))}
                />
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}
