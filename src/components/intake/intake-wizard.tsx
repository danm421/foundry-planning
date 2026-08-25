"use client";

import { useState } from "react";
import {
  isBlankIntakeIncomeRow,
  isBlankIntakePropertyRow,
  type IntakeDraft,
} from "@/lib/intake/schema";
import { childBeneficiaryRef } from "@/lib/intake/goal-rows";
import { isEstateEmpty } from "@/lib/intake/estate";
import { WizardChrome } from "@/components/wizard-chrome";
import {
  IntakeBrandingHeader,
  type IntakeHeaderBranding,
} from "./branding-header";
import { WelcomeScreen } from "./welcome-screen";
import { FamilyStep } from "./steps/family-step";
import { AccountsStep } from "./steps/accounts-step";
import { IncomeStep } from "./steps/income-step";
import { PropertyStep } from "./steps/property-step";
import { GoalsStep, type GoalBeneficiary } from "./steps/goals-step";
import { EstateStep } from "./steps/estate-step";
import { DocumentsStep } from "./steps/documents-step";
import { RiskStep } from "./steps/risk-step";
import { ReviewStep } from "./review-step";
import type { IntakeUploadContext } from "./intake-upload-zone";
import type { IntakeDocumentView } from "@/lib/intake/document-types";
import {
  DEFAULT_INTAKE_SECTIONS,
  INTAKE_SECTION_LABELS,
  renderableSections,
  type IntakeSectionKey,
} from "@/lib/intake/sections";

// ─── Public interface ────────────────────────────────────────────────────────
export interface IntakeWizardProps {
  value: IntakeDraft;
  onChange: (next: IntakeDraft) => void;
  onSubmit: () => Promise<void>;
  mode: "blank" | "prefilled";
  busy?: boolean;
  error?: string | null;
  /** Firm letterhead; null/undefined renders the Foundry Planning lockup. */
  branding?: IntakeHeaderBranding | null;
  /** Public link token — the upload zones post to it. Absent in the
   *  authenticated portal wizard and the advisor's preview, neither of which
   *  uploads anything. */
  token?: string;
  /** Documents already uploaded against this form. */
  documents?: IntakeDocumentView[];
  /** Refetch `documents` — the wizard never fetches, its owner does. */
  onDocumentsChanged?: () => void;
  /**
   * Render the upload UI as an inert visual sample: the Documents step and the
   * three contextual zones appear with their real layout and copy, but nothing
   * is wired to them. For the advisor's preview, which shows a firm what its
   * clients will fill in and must make no request while doing it.
   *
   * Deliberately a separate flag rather than a placeholder `token`: the sample
   * has no credential to hand anything, so no code path from the preview can
   * reach the upload routes. Ignored when the live upload props are present.
   */
  sampleUploads?: boolean;
  /**
   * Which sections this form collects. Optional, defaulting to the full default
   * set: unlike `token`/`documents` (where a forgotten prop must fail closed and
   * offer nothing), a forgotten `sections` should show the form everyone got
   * before this feature existed, never a silently truncated one.
   */
  sections?: readonly IntakeSectionKey[];
}

// ─── Section / sub-step state machine ───────────────────────────────────────
// Flat ordered list of all steps the wizard traverses:
//   welcome → family → assets:accounts → assets:income → assets:property → goals → review

interface StepDescriptor {
  section: "welcome" | "family" | "assets" | "goals" | "estate" | "documents" | "risk" | "review";
  subStep?: "accounts" | "income" | "property";
  /** Chrome label (shown in progress bar + eyebrow) */
  label: string;
  /** H1 shown inside WizardChrome */
  title: string;
  /** Income + Property are optional; family is required */
  skipable?: boolean;
}

/** A step's H1 is always the section's canonical label, and the progress-bar
 *  chip reuses it unless a shorter one is passed. */
function sectionStep(
  key: IntakeSectionKey,
  rest: Omit<StepDescriptor, "label" | "title"> & { label?: string },
): StepDescriptor {
  const title = INTAKE_SECTION_LABELS[key];
  return { label: title, title, ...rest };
}

/** Every switchable step, keyed by its section. Order here is irrelevant —
 *  `buildSteps` walks `sections`, which is already in canonical order. */
const STEP_BY_SECTION: Record<IntakeSectionKey, StepDescriptor> = {
  family:    sectionStep("family",    { section: "family" }),
  accounts:  sectionStep("accounts",  { section: "assets", subStep: "accounts" }),
  income:    sectionStep("income",    { section: "assets", subStep: "income", skipable: true }),
  property:  sectionStep("property",  { section: "assets", subStep: "property", skipable: true }),
  goals:     sectionStep("goals",     { section: "goals" }),
  // Skipable: a client who has not settled on a guardian must still be able to
  // send the rest of the form rather than abandoning it on this step.
  estate:    sectionStep("estate",    { section: "estate", skipable: true }),
  documents: sectionStep("documents", { section: "documents", skipable: true }),
  // The only step whose chip and H1 differ: the progress bar lays every label
  // out on one row, so Risk stays compact there while the H1 reads in full.
  risk:      sectionStep("risk",      { section: "risk", label: "Risk", skipable: true }),
};

// Welcome and Review are wizard chrome, not sections — they always render and
// are deliberately absent from INTAKE_SECTIONS, so their labels live here.
const WELCOME_STEP: StepDescriptor = { section: "welcome", label: "Welcome", title: "Welcome" };
const REVIEW_STEP: StepDescriptor = { section: "review", label: "Review", title: "Review & Submit" };

/** Welcome → the selected sections in canonical order → Review. */
function buildSteps(sections: readonly IntakeSectionKey[]): readonly StepDescriptor[] {
  return [WELCOME_STEP, ...sections.map((s) => STEP_BY_SECTION[s]), REVIEW_STEP];
}

/**
 * Flat index of a step, for ReviewStep's jump-back links. Derived from the
 * step list rather than a parallel map, so the optional Documents step can't
 * shift `review` out from under a hardcoded number.
 */
function indexOfSection(
  steps: readonly StepDescriptor[],
  section: "family" | "accounts" | "income" | "property" | "goals" | "estate" | "documents" | "risk",
): number {
  return steps.findIndex((s) => (s.subStep ?? s.section) === section);
}

// ─── Slice setters ──────────────────────────────────────────────────────────

function useDraftSliceSetters(value: IntakeDraft, onChange: (next: IntakeDraft) => void) {
  const setFamily: (patch: IntakeDraft["family"]) => void = (patch) =>
    onChange({ ...value, family: patch });
  const setAccounts: (patch: IntakeDraft["accounts"]) => void = (patch) =>
    onChange({ ...value, accounts: patch });
  const setIncome: (patch: IntakeDraft["income"]) => void = (patch) =>
    onChange({ ...value, income: patch });
  const setProperty: (patch: IntakeDraft["property"]) => void = (patch) =>
    onChange({ ...value, property: patch });
  const setGoals: (patch: IntakeDraft["goals"]) => void = (patch) =>
    onChange({ ...value, goals: patch });
  const setEstate: (patch: IntakeDraft["estate"]) => void = (patch) =>
    onChange({ ...value, estate: patch });
  const setRisk: (patch: IntakeDraft["risk"]) => void = (patch) =>
    onChange({ ...value, risk: patch });
  return { setFamily, setAccounts, setIncome, setProperty, setGoals, setEstate, setRisk };
}

// ─── Skip affordance ─────────────────────────────────────────────────────────

/**
 * A skipable step keeps its "Skip for now" label only while it is genuinely
 * empty. Once the client has entered something, "Skip for now" reads as
 * "discard what I just typed" — so the button becomes a plain "Next".
 *
 * A card the client added but never filled in doesn't count as content: that's
 * the same row submit prunes (`isBlankIntake*Row`), so the label agrees with
 * what actually gets saved.
 *
 * An uploaded document is content too — a client who answered the Income step
 * with a pay stub instead of a row has not skipped it.
 */
function offersSkip(
  step: StepDescriptor,
  draft: IntakeDraft,
  documents: IntakeDocumentView[],
): boolean {
  if (!step.skipable) return false;
  const hasDoc = (t: string) => documents.some((d) => d.docType === t);
  if (step.subStep === "income") {
    return (draft.income ?? []).every(isBlankIntakeIncomeRow) && !hasDoc("paystub");
  }
  if (step.subStep === "property") {
    return (draft.property ?? []).every(isBlankIntakePropertyRow) && !hasDoc("mortgage");
  }
  if (step.section === "documents") return documents.length === 0;
  // Same rule as Income and Property, asked through the shared predicate so the
  // label agrees with what the review card calls an empty step.
  if (step.section === "estate") return isEstateEmpty(draft.estate);
  // Same rule as Income and Property: "Skip for now" only while the step is
  // genuinely empty. Once an answer exists, the label would read as "discard
  // what I just picked".
  if (step.section === "risk") {
    return Object.keys(draft.risk?.answers ?? {}).length === 0;
  }
  return true;
}

// ─── Goal beneficiaries ──────────────────────────────────────────────────────

/**
 * Everyone the Family step has named, for the Goals step's "who is this for"
 * picker: the client, the spouse, then the children in entry order.
 *
 * The picker's VALUE is a structural ref, not the name, so two children called
 * Emma stay distinguishable and a later rename doesn't orphan the goal. Only
 * rows with a name are offered — an unnamed one has nothing to show — but the
 * child refs stay pinned to the ORIGINAL index, because that's what apply
 * matches against.
 */
function goalBeneficiaries(draft: IntakeDraft): GoalBeneficiary[] {
  const family = draft.family;
  const people: GoalBeneficiary[] = [
    { ref: "client", name: family?.primary?.firstName ?? "", dateOfBirth: family?.primary?.dateOfBirth },
    { ref: "spouse", name: family?.spouse?.firstName ?? "", dateOfBirth: family?.spouse?.dateOfBirth },
    ...(family?.children ?? []).map((child, i) => ({
      ref: childBeneficiaryRef(i),
      name: child.firstName ?? "",
      dateOfBirth: child.dateOfBirth,
    })),
  ];
  return people
    .map((p) => ({ ...p, name: p.name.trim() }))
    .filter((p) => p.name !== "");
}

// ─── Shell ───────────────────────────────────────────────────────────────────

export function IntakeWizard({
  value,
  onChange,
  onSubmit,
  mode,
  busy,
  error,
  branding,
  token,
  documents,
  onDocumentsChanged,
  sampleUploads,
  sections,
}: IntakeWizardProps) {
  // 0 = welcome; then the selected sections in canonical order (Documents only
  // where uploads are offered); then review.
  const [flatIndex, setFlatIndex] = useState(0);
  const { setFamily, setAccounts, setIncome, setProperty, setGoals, setEstate, setRisk } =
    useDraftSliceSetters(value, onChange);

  // Live uploads are all three or none: a list with no token can't upload, and
  // uploads with no refetch callback would leave the client staring at a stale
  // list. Falling short of all three doesn't fall back to the sample — that has
  // to be asked for, so a host that simply forgot a prop still gets nothing.
  const uploads: IntakeUploadContext | undefined =
    token && documents && onDocumentsChanged
      ? { kind: "live", token, documents, onChanged: onDocumentsChanged }
      : sampleUploads
        ? { kind: "sample" }
        : undefined;

  // Only real uploads count as answers. The sample's illustrative row lives
  // inside the zone and is invisible here on purpose: it must not flip a step's
  // "Skip for now" to "Next", or the preview would misreport its own copy.
  const docs = uploads?.kind === "live" ? uploads.documents : [];

  // Resolved once, here, and fed to the step list, the welcome overview and the
  // review screen alike — that is what keeps the three from disagreeing about
  // what this form collects. The portal's own "nothing to render" fallback asks
  // the same function, so the two cannot drift into a redirect loop.
  const activeSections = renderableSections(
    sections ?? DEFAULT_INTAKE_SECTIONS,
    uploads != null,
  );

  const steps = buildSteps(activeSections);
  const step = steps[flatIndex];
  const isFirst = flatIndex === 0;
  const isLast = flatIndex === steps.length - 1;

  function goNext() {
    if (!isLast) setFlatIndex((i) => i + 1);
  }
  function goBack() {
    if (!isFirst) setFlatIndex((i) => i - 1);
  }
  function goToSection(
    section: "family" | "accounts" | "income" | "property" | "goals" | "estate" | "documents" | "risk",
  ) {
    const idx = indexOfSection(steps, section);
    if (idx >= 0) setFlatIndex(idx);
  }

  // Welcome screen uses its own full-page chrome
  if (step.section === "welcome") {
    return (
      <div>
        <IntakeBrandingHeader branding={branding} />
        {error && (
          <div
            role="alert"
            className="mx-auto max-w-2xl px-4 pt-4 text-sm text-crit"
          >
            {error}
          </div>
        )}
        <WelcomeScreen mode={mode} onStart={goNext} sections={activeSections} />
      </div>
    );
  }

  // All other steps use WizardChrome
  // The Welcome screen has its own chrome, so chrome index trails flat by one.
  const chromeIndex = flatIndex - 1;
  const isReview = step.section === "review";

  // On review: the chrome Next button IS the Submit (single affordance).
  const nextLabel = isReview
    ? "Submit"
    : offersSkip(step, value, docs)
      ? "Skip for now"
      : "Next";

  function renderBody() {
    switch (step.section) {
      case "family":
        return <FamilyStep value={value.family} onChange={setFamily} />;
      case "assets":
        if (step.subStep === "accounts")
          return (
            <AccountsStep
              value={value.accounts}
              onChange={setAccounts}
              clientName={value.family?.primary?.firstName}
              spouseName={value.family?.spouse?.firstName ?? undefined}
              hasSpouse={value.family?.spouse != null}
              uploads={uploads}
            />
          );
        if (step.subStep === "income")
          return (
            <IncomeStep
              value={value.income}
              onChange={setIncome}
              clientName={value.family?.primary?.firstName}
              spouseName={value.family?.spouse?.firstName ?? undefined}
              hasSpouse={value.family?.spouse != null}
              uploads={uploads}
            />
          );
        if (step.subStep === "property")
          return (
            <PropertyStep
              value={value.property}
              onChange={setProperty}
              clientName={value.family?.primary?.firstName}
              spouseName={value.family?.spouse?.firstName ?? undefined}
              hasSpouse={value.family?.spouse != null}
              uploads={uploads}
            />
          );
        return null;
      case "goals":
        return (
          <GoalsStep
            value={value.goals}
            onChange={setGoals}
            beneficiaries={goalBeneficiaries(value)}
          />
        );
      case "estate":
        return (
          <EstateStep
            value={value.estate}
            onChange={setEstate}
            family={value.family}
            collectsFamily={activeSections.includes("family")}
            // Both slices in ONE update. Calling `setFamily` and then
            // `setEstate` would apply two patches to the same draft snapshot,
            // and the second would silently drop the child the first added.
            onAddFamilyChild={(child, estate) =>
              onChange({
                ...value,
                family: {
                  ...value.family,
                  children: [...(value.family?.children ?? []), child],
                },
                estate,
              })
            }
          />
        );
      case "documents":
        return uploads ? <DocumentsStep uploads={uploads} /> : null;
      case "risk":
        return <RiskStep value={value.risk} onChange={setRisk} />;
      case "review":
        return (
          <ReviewStep
            value={value}
            sections={activeSections}
            onEdit={goToSection}
          />
        );
      default:
        return null;
    }
  }

  return (
    // A column so WizardChrome's footer can be pushed to the bottom — but the
    // HEIGHT comes from the host, never from this component. The standalone
    // /intake shells wrap us in `min-h-dvh` and the footer lands on the viewport
    // edge; the client portal renders us inside its own `lg:h-dvh` scrollport,
    // where claiming a viewport height here would overflow it on every step.
    <div className="flex flex-1 flex-col">
      <IntakeBrandingHeader branding={branding} />
      {error && (
        <div
          role="alert"
          className="mx-auto max-w-2xl px-4 pt-4 text-sm text-crit"
        >
          {error}
        </div>
      )}
      <WizardChrome
        stepLabels={steps.slice(1).map((s) => s.label)}
        eyebrow="Intake"
        current={chromeIndex}
        title={step.title}
        onBack={goBack}
        onNext={isReview ? () => void onSubmit() : goNext}
        nextLabel={nextLabel}
        backDisabled={false}
        nextDisabled={busy}
        busy={busy}
      >
        {renderBody()}
      </WizardChrome>
    </div>
  );
}
