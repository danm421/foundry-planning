import type { ClientData } from "@/engine/types";
import type { OnboardingState, StepSlug, StepStatus } from "./types";
import { STEPS } from "./steps";

const SKIPPABLE: Record<StepSlug, boolean> = Object.fromEntries(
  STEPS.map((s) => [s.slug, s.skippable]),
) as Record<StepSlug, boolean>;

export function deriveStepStatuses(
  tree: ClientData,
  state: OnboardingState,
): StepStatus[] {
  const skipped = new Set(state.skippedSteps ?? []);
  const out: StepStatus[] = [];

  for (const def of STEPS) {
    if (def.slug === "review") {
      // computed last
      out.push({ slug: "review", kind: "untouched", gaps: [] });
      continue;
    }

    if (skipped.has(def.slug) && def.skippable) {
      out.push({ slug: def.slug, kind: "skipped", gaps: [] });
      continue;
    }

    out.push(computeStatus(def.slug, tree));
  }

  // Review = derived from all preceding statuses.
  const review = out.find((s) => s.slug === "review")!;
  const blockers = out.filter(
    (s) => s.slug !== "review" && s.kind !== "complete" && s.kind !== "skipped",
  );
  review.kind = blockers.length === 0
    ? (out.some((s) => s.slug !== "review" && s.kind === "complete") ? "complete" : "untouched")
    : blockers.some((b) => b.kind === "in_progress") ? "in_progress" : "untouched";
  review.gaps = blockers.map((b) => b.slug);

  // Non-skippable steps ignore stale skip flags — re-derive them ignoring skip.
  // (Already handled above via SKIPPABLE guard.)
  void SKIPPABLE;

  return out;
}

function computeStatus(slug: StepSlug, tree: ClientData): StepStatus {
  switch (slug) {
    case "household":
      return householdStatus(tree);
    case "family":
      return familyStatus(tree);
    case "entities":
      return entitiesStatus(tree);
    case "accounts":
      return accountsStatus(tree);
    case "liabilities":
      return liabilitiesStatus(tree);
    case "cash-flow":
      return cashFlowStatus(tree);
    case "insurance":
      return insuranceStatus(tree);
    case "estate":
      return estateStatus(tree);
    case "assumptions":
      return assumptionsStatus(tree);
    case "review":
      return { slug, kind: "untouched", gaps: [] };
  }
}

function householdStatus(tree: ClientData): StepStatus {
  const c = tree.client;
  const requiredSingle: [string, unknown][] = [
    ["First name", c.firstName],
    ["Last name", c.lastName],
    ["Date of birth", c.dateOfBirth],
    ["Retirement age", c.retirementAge],
    ["Life expectancy", c.lifeExpectancy],
  ];
  const gaps: string[] = [];
  for (const [label, val] of requiredSingle) {
    if (!val) gaps.push(label);
  }
  if (c.filingStatus === "joint") {
    if (!c.spouseName) gaps.push("Spouse first name");
    if (!c.spouseDob) gaps.push("Spouse date of birth");
    if (!c.spouseRetirementAge) gaps.push("Spouse retirement age");
    if (!c.spouseLifeExpectancy) gaps.push("Spouse life expectancy");
  }
  const filledCount = requiredSingle.filter(([, v]) => Boolean(v)).length;
  let kind: StepStatus["kind"] = "untouched";
  if (gaps.length === 0) kind = "complete";
  else if (filledCount > 0) kind = "in_progress";
  return { slug: "household", kind, gaps };
}

function familyStatus(tree: ClientData): StepStatus {
  const members = (tree as unknown as { familyMembers?: { role?: string }[] }).familyMembers ?? [];
  const nonPrincipal = members.filter((m) => m.role !== "client" && m.role !== "spouse");
  return {
    slug: "family",
    kind: nonPrincipal.length > 0 ? "complete" : "untouched",
    gaps: nonPrincipal.length > 0 ? [] : ["No children or dependents added"],
  };
}

function entitiesStatus(tree: ClientData): StepStatus {
  const ents = tree.entities ?? [];
  return {
    slug: "entities",
    kind: ents.length > 0 ? "complete" : "untouched",
    gaps: ents.length > 0 ? [] : ["No entities added"],
  };
}

function accountsStatus(tree: ClientData): StepStatus {
  return {
    slug: "accounts",
    kind: tree.accounts.length > 0 ? "complete" : "untouched",
    gaps: tree.accounts.length > 0 ? [] : ["No accounts added"],
  };
}

function liabilitiesStatus(tree: ClientData): StepStatus {
  return {
    slug: "liabilities",
    kind: tree.liabilities.length > 0 ? "complete" : "untouched",
    gaps: tree.liabilities.length > 0 ? [] : ["No liabilities added"],
  };
}

function cashFlowStatus(tree: ClientData): StepStatus {
  const gaps: string[] = [];
  if (tree.incomes.length === 0) gaps.push("At least one income required");
  if (tree.expenses.length === 0) gaps.push("At least one expense required");
  let kind: StepStatus["kind"] = "untouched";
  if (gaps.length === 0) kind = "complete";
  else if (tree.incomes.length > 0 || tree.expenses.length > 0) kind = "in_progress";
  return { slug: "cash-flow", kind, gaps };
}

function insuranceStatus(tree: ClientData): StepStatus {
  const lifePolicies = tree.accounts.filter((a) => a.category === "life_insurance");
  return {
    slug: "insurance",
    kind: lifePolicies.length > 0 ? "complete" : "untouched",
    gaps: lifePolicies.length > 0 ? [] : ["No life insurance policies added"],
  };
}

function estateStatus(tree: ClientData): StepStatus {
  const willCount = (tree as unknown as { wills?: unknown[] }).wills?.length ?? 0;
  return {
    slug: "estate",
    kind: willCount > 0 ? "complete" : "untouched",
    gaps: willCount > 0 ? [] : ["No will on file"],
  };
}

function assumptionsStatus(_tree: ClientData): StepStatus { // eslint-disable-line @typescript-eslint/no-unused-vars
  // Plan settings rows always exist (created on client creation). Phase 1
  // treats Assumptions as "untouched until skipped or revisited" — there's no
  // strong "default vs override" signal we can read cheaply here.
  return { slug: "assumptions", kind: "untouched", gaps: ["Using firm defaults"] };
}
