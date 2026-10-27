"use client";

// Wizard step 2: who the trust is for. "Benefits now" and "Gets what's left"
// are separate pickers; the remainder follows the first (minus the grantor's
// spouse) until the advisor edits it, tracked by the wizard's `remainderTouched`.

import {
  applyKindPreset,
  evenShares,
  isHouseholdShare,
  spouseOf,
  trustPeopleOptions,
  withoutHousehold,
  type GuidedTrustAnswers,
  type GuidedTrustContext,
  type PersonShare,
} from "@/lib/solver/guided-trust";
import { roleFirstName } from "@/lib/solver/trust-labels";
import { GuidedTrustPeoplePicker } from "./guided-trust-people-picker";
import { Callout, StepHeader } from "./guided-trust-ui";

interface Props {
  answers: GuidedTrustAnswers;
  ctx: GuidedTrustContext;
  onChange: (next: GuidedTrustAnswers) => void;
  remainderTouched: boolean;
  onRemainderTouched: () => void;
}

export function GuidedTrustPeopleStep({
  answers,
  ctx,
  onChange,
  remainderTouched,
  onRemainderTouched,
}: Props) {
  const firstName = (role: "client" | "spouse") => roleFirstName(role, ctx.tree);
  const spouseRole = spouseOf(answers.grantor);

  function setLifetime(lifetime: PersonShare[]) {
    if (remainderTouched) return onChange({ ...answers, lifetime });
    const remainder = evenShares(
      lifetime.filter((s) => !isHouseholdShare(s, spouseRole)).map((s) => s.person),
    );
    onChange({ ...answers, lifetime, remainder });
  }

  function setGrantor(grantor: "client" | "spouse") {
    if (grantor === answers.grantor) return;
    // The new grantor can't also be a beneficiary; a SLAT re-picks the new spouse.
    const next = {
      ...answers,
      grantor,
      lifetime: withoutHousehold(answers.lifetime, grantor),
      remainder: withoutHousehold(answers.remainder, grantor),
    };
    onChange(answers.kind === "slat" ? applyKindPreset(next, "slat") : next);
  }

  const showSlatCallout =
    answers.kind !== "slat" && answers.lifetime.some((s) => isHouseholdShare(s, spouseRole));

  return (
    <div>
      <StepHeader title="Who is it for?" />
      {ctx.isMarried ? (
        <div role="radiogroup" aria-label="Grantor" className="mb-3.5">
          <div className="text-[13px] font-medium text-ink">Grantor</div>
          <div className="mb-1.5 text-[11.5px] text-ink-3">whose gift funds it</div>
          <div className="inline-flex overflow-hidden rounded-[var(--radius-sm)] border border-hair-2 text-[12.5px]">
            {(["client", "spouse"] as const).map((role) => (
              <button
                key={role}
                type="button"
                role="radio"
                aria-checked={answers.grantor === role}
                onClick={() => setGrantor(role)}
                className={`px-3 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60 ${
                  answers.grantor === role ? "bg-accent-wash text-ink" : "text-ink-3 hover:text-ink"
                }`}
              >
                {firstName(role)}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <GuidedTrustPeoplePicker
        label="Benefits now"
        note="can receive income or distributions while the trust runs"
        options={trustPeopleOptions(ctx.tree, answers.grantor, "lifetime")}
        value={answers.lifetime}
        onChange={setLifetime}
      />
      <GuidedTrustPeoplePicker
        label="Gets what's left"
        note="who receives the trust when it ends. This is who the 'to heirs' figures credit."
        options={trustPeopleOptions(ctx.tree, answers.grantor, "remainder")}
        value={answers.remainder}
        onChange={(remainder) => {
          onRemainderTouched();
          onChange({ ...answers, remainder });
        }}
      />

      {showSlatCallout ? (
        <Callout>
          Naming {firstName(spouseRole)} as a lifetime beneficiary makes this a SLAT: the couple
          keeps indirect access to the money, and that access ends if the marriage does.
        </Callout>
      ) : null}
    </div>
  );
}
