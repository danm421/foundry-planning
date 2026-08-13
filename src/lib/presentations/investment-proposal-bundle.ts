// The presentation deck's read of a saved proposal. It reads the FROZEN
// snapshot and nothing else: the numbers on a presented page must be the
// numbers the advisor saw when they computed it, not today's holdings.
//
// Mirrors `investments-bundle.ts` — loaded conditionally by the export route,
// returned as null (never thrown) when the proposal is gone, so a deck whose
// proposal was deleted still renders.
//
// Spec §11 describes the bundle as "the frozen ProposalSnapshot plus the
// client's display names". The names are deliberately NOT copied in: every page
// already receives `clientName` on `RenderPdfInput` and `BuildDataContext`, and
// a second copy is a second thing to keep in sync for no gain.
import { getProposal, listProposals } from "@/lib/investments/proposals/queries";
import type { ProposalSnapshot } from "@/lib/investments/proposals/types";

export interface InvestmentProposalBundle {
  proposalId: string;
  name: string;
  targetLabel: string;
  status: "draft" | "presented" | "accepted";
  /** ISO instant the snapshot was computed — printed as the page's "as of". */
  computedAt: string;
  snapshot: ProposalSnapshot;
}

export async function loadInvestmentProposalBundle(
  clientId: string,
  proposalId: string,
): Promise<InvestmentProposalBundle | null> {
  // An unpicked page carries "" — that is the empty state, not a DB miss.
  if (proposalId === "") return null;
  const row = await getProposal(clientId, proposalId);
  if (!row) return null;
  return {
    proposalId: row.id,
    name: row.name,
    targetLabel: row.targetLabel,
    status: row.status,
    computedAt: row.computedAt.toISOString(),
    snapshot: row.result,
  };
}

export interface ProposalOption {
  id: string;
  name: string;
  targetLabel: string;
  computedAt: string;
}

/** The builder's proposal picker. `listProposals` already orders by most
 *  recently updated, which is the order an advisor expects to pick from. */
export async function loadProposalPickerOptions(clientId: string): Promise<ProposalOption[]> {
  const rows = await listProposals(clientId);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    targetLabel: r.targetLabel,
    computedAt: r.computedAt.toISOString(),
  }));
}
