// src/lib/ops/growth/funnel.ts
//
// Four stages, with names at each. Pure.
//
// The classification is exact rather than heuristic: `clearPendingSignup()` is
// called from exactly one place — the completed-checkout webhook — so a Clerk
// account still holding a `pending_signup` stash provably filled in /welcome
// and never paid. See the guard test in __tests__/funnel.test.ts.
import type { ClerkUserInput, GrowthInput } from "./types";

export type FunnelStage = "signed_up" | "stalled_checkout" | "trialing" | "resolved";

export type FunnelPerson = {
  userId: string;
  name: string;
  email: string | null;
  firmName: string | null;
  firmId: string | null;
  signedUpAt: string;
  lastSignInAt: string | null;
};

export type FunnelStageGroup = {
  stage: FunnelStage;
  label: string;
  people: FunnelPerson[];
};

const LABELS: Record<FunnelStage, string> = {
  signed_up: "Signed up, never started",
  stalled_checkout: "Filled the form, never paid",
  trialing: "Trialing",
  resolved: "Resolved",
};

const ORDER: FunnelStage[] = ["signed_up", "stalled_checkout", "trialing", "resolved"];

function displayName(u: ClerkUserInput): string {
  const full = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
  return full || u.email || u.userId;
}

export function buildFunnel(input: GrowthInput): FunnelStageGroup[] {
  const { firms, subs, users } = input;

  const firmById = new Map(firms.map((f) => [f.firmId, f]));
  const subByFirm = new Map(subs.map((s) => [s.firmId, s]));

  const buckets: Record<FunnelStage, FunnelPerson[]> = {
    signed_up: [], stalled_checkout: [], trialing: [], resolved: [],
  };

  for (const u of users) {
    // A founder seat never entered the funnel — it was granted by beta code.
    if (u.firmIds.some((id) => firmById.get(id)?.isFounder)) continue;

    const firmId = u.firmIds.find((id) => firmById.has(id)) ?? null;
    const firm = firmId ? firmById.get(firmId)! : null;

    let stage: FunnelStage;
    if (firm) {
      // An org exists, so checkout completed — a leftover stash is stale.
      const sub = subByFirm.get(firm.firmId);
      stage = sub?.status === "trialing" ? "trialing" : "resolved";
    } else if (u.hasPendingSignup) {
      stage = "stalled_checkout";
    } else {
      stage = "signed_up";
    }

    buckets[stage].push({
      userId: u.userId,
      name: displayName(u),
      email: u.email,
      firmName: firm?.displayName ?? u.pendingFirmName,
      firmId,
      signedUpAt: u.createdAt.toISOString(),
      lastSignInAt: u.lastSignInAt?.toISOString() ?? null,
    });
  }

  return ORDER.map((stage) => ({ stage, label: LABELS[stage], people: buckets[stage] }));
}
