export type OrgRow = {
  firmId: string;
  displayName: string;
  isFounder: boolean;
  archived: boolean;
  subscriptionStatus: string; // active sub status, "founder", or "none"
  trialEnd: string | null;
  createdAt: string;
};

type FirmInput = {
  firmId: string;
  displayName: string | null;
  isFounder: boolean;
  archivedAt: Date | null;
  createdAt: Date;
};

type SubInput = { firmId: string; status: string; trialEnd: Date | null };

/**
 * Pure mapper: firms + their *active* subscription rows → display rows for the
 * ops Orgs table. Founder firms always show "founder"; non-founders show their
 * active sub status or "none". Keeps the server page thin and testable.
 */
export function buildOrgRows(firms: FirmInput[], activeSubs: SubInput[]): OrgRow[] {
  const subByFirm = new Map(activeSubs.map((s) => [s.firmId, s]));
  return firms.map((f) => {
    const sub = subByFirm.get(f.firmId);
    return {
      firmId: f.firmId,
      displayName: f.displayName ?? "(unnamed)",
      isFounder: f.isFounder,
      archived: f.archivedAt != null,
      subscriptionStatus: f.isFounder ? "founder" : sub?.status ?? "none",
      trialEnd: sub?.trialEnd ? sub.trialEnd.toISOString() : null,
      createdAt: f.createdAt.toISOString(),
    };
  });
}
