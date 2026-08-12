import { RISK_LEVEL_LABELS } from "@/lib/risk-levels";
import type { Placement, SuitabilitySnapshot } from "@/lib/investments/proposals/types";
import { SectionCard, SectionHeading, SectionNote } from "./proposal-section";

const SUITABILITY_TOOLTIP =
  "Places the current holdings and the proposed portfolio on the firm's five-rung risk scale, then compares both against the client's documented risk profile.";

const CONSTRAINT_PHRASES = {
  tolerance: "limited by tolerance",
  capacity: "limited by capacity",
  none: null,
} as const;

const CONFIRMED_FMT = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

/**
 * Where a placement's rung came from. A firm-tagged model portfolio carries its
 * rung directly; anything else is inferred from CMA volatility. The two are
 * genuinely different claims, so they get genuinely different words — read off
 * the flag, never assumed.
 */
function placementBasis(placement: Placement): string {
  return placement.estimated
    ? "Estimated from volatility"
    : "From the firm's risk tag";
}

function PlacementRow({
  label,
  placement,
}: {
  label: string;
  placement: Placement | null;
}) {
  return (
    <tr className="border-b border-hair last:border-0">
      <td className="py-1.5 pr-3 text-[13px] text-ink-2">{label}</td>
      <td className="py-1.5 pr-3 text-[13px] text-ink">
        {placement ? RISK_LEVEL_LABELS[placement.level] : <span className="text-ink-4">—</span>}
      </td>
      <td className="py-1.5 text-right text-[13px] text-ink-3">
        {placement ? placementBasis(placement) : "Not placed"}
      </td>
    </tr>
  );
}

export function ProposalSuitabilitySection({
  suitability,
}: {
  suitability: SuitabilitySnapshot;
}) {
  const {
    clientLevel,
    clientScore,
    bindingConstraint,
    confirmedAt,
    currentPlacement,
    proposedPlacement,
    currentExceedsProfile,
    proposedMatchesProfile,
  } = suitability;

  const constraint = CONSTRAINT_PHRASES[bindingConstraint];
  const profileDetail = [
    clientScore != null ? `score ${Math.round(clientScore)}` : null,
    constraint,
    confirmedAt ? `confirmed ${CONFIRMED_FMT.format(new Date(confirmedAt))}` : "not yet confirmed",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <SectionCard>
      <SectionHeading tooltip={SUITABILITY_TOOLTIP}>Suitability</SectionHeading>

      <table className="w-full">
        <tbody>
          <tr className="border-b border-hair">
            <td className="py-1.5 pr-3 text-[13px] text-ink-2">Client&rsquo;s documented profile</td>
            <td className="py-1.5 pr-3 text-[13px] text-ink">
              {clientLevel ? (
                RISK_LEVEL_LABELS[clientLevel]
              ) : (
                <span className="text-ink-4">—</span>
              )}
            </td>
            <td className="py-1.5 text-right text-[13px] text-ink-3">
              {clientLevel ? profileDetail : "No profile on file"}
            </td>
          </tr>
          <PlacementRow label="Current holdings" placement={currentPlacement} />
          <PlacementRow label="Proposed portfolio" placement={proposedPlacement} />
        </tbody>
      </table>

      <div className="mt-3 space-y-1">
        {clientLevel === null && (
          <SectionNote tone="warn">
            No risk profile on file. Complete the risk questionnaire before presenting this as a
            suitability judgement.
          </SectionNote>
        )}
        {currentPlacement === null && proposedPlacement === null && (
          <SectionNote>
            The firm has no risk-tagged model portfolios, so neither portfolio can be placed on the
            risk scale.
          </SectionNote>
        )}
        {currentExceedsProfile && (
          <SectionNote tone="warn">
            The current holdings sit above the client&rsquo;s documented risk level.
          </SectionNote>
        )}
        {proposedMatchesProfile && (
          <SectionNote tone="good">
            The proposed portfolio matches the client&rsquo;s documented risk level.
          </SectionNote>
        )}
        {clientLevel !== null && !proposedMatchesProfile && proposedPlacement !== null && (
          <SectionNote>
            The proposed portfolio does not sit on the client&rsquo;s documented rung.
          </SectionNote>
        )}
      </div>
    </SectionCard>
  );
}
