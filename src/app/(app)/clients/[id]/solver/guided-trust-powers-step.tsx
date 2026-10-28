"use client";

// Wizard step 3: powers and taxes. Three switches; the "On by default for ..."
// line appears only while a switch still matches what the type's preset sets.

import {
  applyKindPreset,
  type GuidedTrustAnswers,
  type GuidedTrustContext,
  type GuidedTrustKind,
} from "@/lib/solver/guided-trust";
import { usd } from "@/lib/solver/technique-summaries";
import { selectBaseClassName } from "@/components/forms/input-styles";
import { StepHeader, SwitchRow } from "./guided-trust-ui";

interface Props {
  answers: GuidedTrustAnswers;
  ctx: GuidedTrustContext;
  onChange: (next: GuidedTrustAnswers) => void;
}

const KIND_LABEL: Record<GuidedTrustKind, string> = {
  revocable: "a revocable trust",
  irrevocable: "an irrevocable gift trust",
  slat: "a SLAT",
  ilit: "an ILIT",
  idgt: "an IDGT",
  crt: "a CRT",
  clt: "a CLT",
};

export function GuidedTrustPowersStep({ answers, ctx, onChange }: Props) {
  const { client } = ctx.tree;
  const grantorName =
    (answers.grantor === "spouse" ? client.spouseName : client.firstName) ?? "The grantor";
  const exclusion = ctx.annualExclusionByYear[ctx.planStartYear];
  const preset = applyKindPreset(answers, answers.kind);
  const why = (key: "isGrantor" | "crummeyPowers" | "accessibleToClient") =>
    answers[key] && preset[key] ? `On by default for ${KIND_LABEL[answers.kind]}` : null;

  const years: number[] = [];
  for (let y = ctx.planStartYear; y <= ctx.tree.planSettings.planEndYear; y++) years.push(y);

  return (
    <div>
      <StepHeader title="Powers & taxes" subtitle="How the trust is taxed and how gifts to it count." />

      <SwitchRow
        name="Grantor trust"
        note={`${grantorName} pays the trust's income tax. Each payment is effectively an extra tax-free gift: the trust grows faster and the estate shrinks faster.`}
        why={why("isGrantor")}
        checked={answers.isGrantor}
        onToggle={() => onChange({ ...answers, isGrantor: !answers.isGrantor })}
      >
        {answers.isGrantor ? (
          <div className="mt-1.5 flex items-center gap-1.5 text-[12px] text-ink-3">
            <label htmlFor="guided-trust-grantor-end">Turn off in</label>
            <select
              id="guided-trust-grantor-end"
              value={answers.grantorStatusEndYear ?? ""}
              onChange={(e) =>
                onChange({
                  ...answers,
                  grantorStatusEndYear: e.target.value === "" ? null : Number(e.target.value),
                })
              }
              className={`${selectBaseClassName} h-7 w-24 px-2 text-[12.5px]`}
            >
              <option value="">Never</option>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </SwitchRow>

      <SwitchRow
        name="Crummey powers"
        note={
          exclusion != null
            ? `Beneficiaries get a short window to withdraw each gift, so up to ${usd(exclusion)} a year per beneficiary counts against the annual exclusion instead of lifetime exemption.`
            : "Beneficiaries get a short window to withdraw each gift, so up to the annual exclusion a year per beneficiary counts against it instead of lifetime exemption."
        }
        why={why("crummeyPowers")}
        checked={answers.crummeyPowers}
        onToggle={() => onChange({ ...answers, crummeyPowers: !answers.crummeyPowers })}
      />

      {answers.kind !== "revocable" ? (
        <SwitchRow
          name="Household can draw on it"
          note="Shows the trust's assets as reachable by the family in cash-flow views. It doesn't move money or change taxes."
          why={why("accessibleToClient")}
          checked={answers.accessibleToClient}
          onToggle={() => onChange({ ...answers, accessibleToClient: !answers.accessibleToClient })}
        />
      ) : null}
    </div>
  );
}
