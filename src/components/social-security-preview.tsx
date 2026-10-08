import type { ClientInfo } from "@/engine/types";
import { personLabel } from "@/lib/owner-labels";
import { ageLabel, type SsEntryPreview } from "@/lib/social-security/benefit-entry";

/** The Social Security editors' live preview: PIA, the benefit at the claim
 *  age, and each person's spousal top-up. Shared by the app and Solver dialogs. */
export function SocialSecurityPreview({ preview, client }: {
  preview: SsEntryPreview;
  client: ClientInfo;
}) {
  const claimMonths = preview.claimAgeMonths;
  const claimLabel = claimMonths != null ? ageLabel(Math.floor(claimMonths / 12), claimMonths % 12) : "the claim age";
  const nameFor = (who: "client" | "spouse") =>
    personLabel(who, { clientName: client.firstName, spouseName: client.spouseName ?? null });
  // The reason holds only when both have a benefit to compare; two $0 PIAs
  // also draw no top-up, for a different reason.
  const bothHavePia = preview.piaMonthly > 0 && (preview.otherPiaMonthly ?? 0) > 0;
  return (
    <div className="text-[14px] text-ink-2 mb-4 space-y-0.5">
      <p>
        PIA ${Math.round(preview.piaMonthly).toLocaleString()}/mo
        {preview.ownAnnual != null && ` · At ${claimLabel}: $${Math.round(preview.ownAnnual).toLocaleString()}/yr`}
      </p>
      {(["client", "spouse"] as const).map((who) => {
        const v = preview.topUps[who];
        if (v == null || v <= 0) return null;
        return <p key={who}>{nameFor(who)}&apos;s spousal top-up: ${Math.round(v).toLocaleString()}/mo</p>;
      })}
      {bothHavePia && preview.topUps.client === 0 && preview.topUps.spouse === 0 && (
        <p className="text-ink-3">No spousal top-up — each benefit is larger than half the other&apos;s PIA.</p>
      )}
    </div>
  );
}
