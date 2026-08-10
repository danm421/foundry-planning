import type { ReactElement } from "react";
import { loadPortalHousehold } from "@/lib/portal/load-profile-data";
import HouseholdContactCards from "@/components/portal/household-contact-cards";

interface Props {
  clientId: string;
}

const FILING_STATUS_LABELS: Record<string, string> = {
  single: "Single",
  married_joint: "Married filing jointly",
  married_separate: "Married filing separately",
  head_of_household: "Head of household",
};

export default async function HouseholdSection({
  clientId,
}: Props): Promise<ReactElement> {
  // Same loader the GET route uses, rather than a second copy of the query.
  // It owns the column projection that keeps `crm_household_contacts`'
  // advisor-only columns (ssnLast4, notes, employer, DOB) out of a
  // client-facing payload — that decision should live in exactly one place.
  const household = await loadPortalHousehold(clientId);

  if (!household) {
    return (
      <div className="p-5 text-[13px] text-ink-3">Household not found.</div>
    );
  }

  return (
    <div className="max-w-4xl space-y-5 p-5 sm:p-6">
      <header className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <h1 className="text-[18px] font-semibold text-ink">
          Household<span className="dot">.</span>
        </h1>
        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-[12px] text-ink-3">
          {household.filingStatus && (
            <span>
              Filing status{" "}
              <span className="text-ink-2">
                {FILING_STATUS_LABELS[household.filingStatus] ??
                  household.filingStatus}
              </span>
            </span>
          )}
          {household.lifeExpectancy != null && (
            <span>
              Plan horizon{" "}
              <span className="text-ink-2">
                through age{" "}
                <span className="tabular">{household.lifeExpectancy}</span>
              </span>
            </span>
          )}
        </div>
      </header>

      <HouseholdContactCards
        primary={household.primary}
        spouse={household.spouse}
        editEnabled={household.portalEditEnabled}
      />
    </div>
  );
}
