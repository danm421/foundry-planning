"use client";

import { useMemo, useState } from "react";

import {
  PREDECEASED_QUESTION,
  PREDECEASED_RULE_LABELS,
  beneficiaryShareTotal,
  estateBeneficiaryOptions,
  findBeneficiary,
  nextOtherBeneficiaryRef,
  setBeneficiary,
  sharePercentLabel,
  splitFullName,
  toggleBeneficiary,
  type EstateHousehold,
} from "@/lib/intake/estate";
import { INTAKE_PREDECEASED_RULES, type IntakeDraft } from "@/lib/intake/schema";
import { FieldTooltip } from "@/components/forms/field-tooltip";
import {
  ChoiceCard,
  DecimalInput,
  SectionHeading,
  StepCard,
  YesNo,
  domId,
  inputCls,
  labelCls,
} from "./card-list";

type Estate = NonNullable<IntakeDraft["estate"]>;
type Inheritance = Estate["inheritance"];
type BeneficiaryRow = NonNullable<NonNullable<Inheritance>["beneficiaries"]>[number];
type ChildRow = NonNullable<NonNullable<IntakeDraft["family"]>["children"]>[number];

export interface EstateBeneficiariesProps {
  value: Inheritance;
  onChange: (next: Inheritance) => void;
  /** The Family step's answers. Names and dates of birth are READ from here —
   *  the picklist never re-collects what the client already typed. */
  family: IntakeDraft["family"];
  household: EstateHousehold;
  /**
   * Whether this form collects the Family step at all. An estate-only form has
   * no children list to add anybody to, so a quick-added child is kept as a
   * hand-added beneficiary instead. An explicit flag rather than "is
   * `onAddFamilyChild` present" — a forgotten prop must not silently change
   * where the client's answer lands.
   */
  collectsFamily: boolean;
  /**
   * Add a child to the FAMILY step and tick them here, in ONE draft update.
   *
   * Deliberately not two calls to two slice setters: each one spreads the draft
   * it was built with, so a family update followed by an estate update would
   * discard the first. The caller applies both at once.
   */
  onAddFamilyChild: (child: ChildRow, nextInheritance: Inheritance) => void;
}

// ─── EstateBeneficiaries ─────────────────────────────────────────────────────

export function EstateBeneficiaries({
  value,
  onChange,
  family,
  household,
  collectsFamily,
  onAddFamilyChild,
}: EstateBeneficiariesProps) {
  // One clock for the whole render pass, so two rows a millisecond apart can't
  // report different ages.
  const today = useMemo(() => new Date(), []);

  const inheritance = value ?? {};
  const rows = inheritance.beneficiaries ?? [];
  const options = estateBeneficiaryOptions(family, inheritance, today);
  const chosen = options.filter((o) => o.selected);
  const sharing = inheritance.sharing;
  const total = beneficiaryShareTotal(inheritance);

  const [adding, setAdding] = useState<"child" | "other" | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftDob, setDraftDob] = useState("");
  const [draftRelationship, setDraftRelationship] = useState("");

  function patch(next: Partial<NonNullable<Inheritance>>) {
    onChange({ ...inheritance, ...next } as Inheritance);
  }

  function setRows(next: BeneficiaryRow[]) {
    patch({ beneficiaries: next });
  }

  function closeAdd() {
    setAdding(null);
    setDraftName("");
    setDraftDob("");
    setDraftRelationship("");
  }

  function commitAdd() {
    const name = draftName.trim();
    if (name === "") return;

    if (adding === "child" && collectsFamily) {
      const { firstName, lastName } = splitFullName(name);
      // Appended, so the new child's index is the current length — and appending
      // is what keeps every existing "child:<index>" ref pointing at the same
      // person.
      const index = (family?.children ?? []).length;
      onAddFamilyChild({ firstName, lastName, dateOfBirth: draftDob }, {
        ...inheritance,
        beneficiaries: [...rows, { ref: `child:${index}` } as BeneficiaryRow],
      });
    } else {
      setRows([
        ...rows,
        {
          ref: nextOtherBeneficiaryRef(rows),
          name,
          relationship:
            adding === "child" ? "Child" : draftRelationship.trim() || undefined,
          dateOfBirth: draftDob || undefined,
        } as BeneficiaryRow,
      ]);
    }
    closeAdd();
  }

  const heading =
    inheritance.spouseFirst === true
      ? "Once you are both gone, who inherits?"
      : "Who inherits?";

  return (
    <section aria-labelledby="estate-inherits-heading" className="space-y-4">
      <div>
        <SectionHeading id="estate-inherits-heading">Who inherits</SectionHeading>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-3">
          Who your will and trust leave your estate to. Beneficiaries you named
          directly on a retirement account or a life insurance policy are
          separate — we will go through those with you.
        </p>
      </div>

      {/* ── Everything to the spouse first? ───────────────────────────────── */}
      {household.hasSpouse && (
        <StepCard>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 text-[14px] text-ink">
              Does everything go to{" "}
              {household.spouseName ?? "your spouse or partner"} first?
              <FieldTooltip text="The usual arrangement: your spouse inherits everything, and the people below inherit only once you are both gone. Answer no if you want some of it to go elsewhere straight away." />
            </span>
            <YesNo
              label={`Does everything go to ${household.spouseName ?? "your spouse or partner"} first?`}
              value={inheritance.spouseFirst}
              onChange={(next) => patch({ spouseFirst: next })}
            />
          </div>
        </StepCard>
      )}

      {/* ── The picklist ──────────────────────────────────────────────────── */}
      <StepCard>
        <p id="estate-inherits-list" className="mb-4 text-[14px] font-medium text-ink">
          {heading}
        </p>

        {options.length > 0 && (
          <div role="group" aria-labelledby="estate-inherits-list" className="space-y-2">
            {options.map((option) => (
              <div key={option.ref} className="flex items-center gap-2">
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={option.selected}
                  onClick={() =>
                    setRows(
                      toggleBeneficiary(
                        rows,
                        option.ref,
                        () => ({ ref: option.ref }) as BeneficiaryRow,
                      ),
                    )
                  }
                  className={`flex min-w-0 flex-1 items-center gap-3 rounded-[var(--radius-sm)] border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                    option.selected
                      ? "border-accent bg-accent-wash/30"
                      : "border-hair bg-card-2 hover:border-hair-2"
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`flex h-4 w-4 flex-none items-center justify-center rounded-[3px] border ${
                      option.selected ? "border-accent bg-accent" : "border-hair-2"
                    }`}
                  >
                    {option.selected && (
                      <svg
                        width="10"
                        height="10"
                        viewBox="0 0 14 14"
                        fill="none"
                        stroke="var(--color-accent-on)"
                        strokeWidth={2}
                      >
                        <path d="M2.5 7.5l3 3 6-6" />
                      </svg>
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] text-ink">
                      {option.name || "Unnamed"}
                    </span>
                    {option.detail && (
                      <span className="block truncate text-[12px] text-ink-4">
                        {option.detail}
                      </span>
                    )}
                  </span>
                </button>
                {!option.fromFamily && (
                  <button
                    type="button"
                    onClick={() => setRows(rows.filter((r) => r.ref !== option.ref))}
                    aria-label={`Remove ${option.name || "this beneficiary"}`}
                    className="flex-none rounded-[var(--radius-sm)] border border-hair px-2 py-1 text-[11px] font-medium uppercase tracking-[0.06em] text-ink-3 transition-colors hover:border-crit hover:text-crit"
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ── Adding somebody the list does not hold ─────────────────────── */}
        {adding === null ? (
          <div className="mt-4 flex flex-wrap gap-2">
            <AddButton onClick={() => setAdding("child")}>Add a child</AddButton>
            <AddButton onClick={() => setAdding("other")}>Add someone else</AddButton>
          </div>
        ) : (
          <div className="mt-4 rounded-[var(--radius-sm)] border border-hair bg-card-2 p-4">
            <p className="mb-3 text-[13px] font-medium text-ink">
              {adding === "child" ? "Add a child" : "Add someone else"}
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="estate-add-name" className={labelCls}>
                  Full name
                </label>
                <input
                  id="estate-add-name"
                  type="text"
                  className={inputCls}
                  value={draftName}
                  autoComplete="off"
                  onChange={(e) => setDraftName(e.target.value)}
                />
              </div>
              {adding === "child" ? (
                <div>
                  <label htmlFor="estate-add-dob" className={labelCls}>
                    Date of birth
                  </label>
                  <input
                    id="estate-add-dob"
                    type="date"
                    className={`${inputCls} tabular`}
                    value={draftDob}
                    onChange={(e) => setDraftDob(e.target.value)}
                  />
                </div>
              ) : (
                <div>
                  <label htmlFor="estate-add-relationship" className={labelCls}>
                    Relationship to you
                    <span className="ml-1 font-normal normal-case text-ink-4">
                      (optional)
                    </span>
                  </label>
                  <input
                    id="estate-add-relationship"
                    type="text"
                    className={inputCls}
                    value={draftRelationship}
                    placeholder="e.g. my sister"
                    onChange={(e) => setDraftRelationship(e.target.value)}
                  />
                </div>
              )}
            </div>
            {adding === "child" && collectsFamily && (
              <p className="mt-3 text-[12px] text-ink-4">
                We will add them to your family details too, so you only enter
                them once.
              </p>
            )}
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={commitAdd}
                disabled={draftName.trim() === "" || (adding === "child" && draftDob === "")}
                className="rounded-[var(--radius-sm)] bg-accent px-4 py-1.5 text-[13px] font-medium text-accent-on transition-opacity disabled:opacity-40"
              >
                Add
              </button>
              <button
                type="button"
                onClick={closeAdd}
                className="rounded-[var(--radius-sm)] border border-hair px-4 py-1.5 text-[13px] text-ink-3 transition-colors hover:text-ink"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </StepCard>

      {/* ── How much each of them gets ────────────────────────────────────── */}
      {chosen.length > 1 && (
        <StepCard>
          <p
            id="estate-shares-heading"
            className="mb-4 text-[14px] font-medium text-ink"
          >
            How much does each of them get?
          </p>
          <div
            className="space-y-3"
            role="radiogroup"
            aria-labelledby="estate-shares-heading"
          >
            <ChoiceCard
              id="estate-shares-equal"
              title="Split equally"
              nested
              selected={sharing === "equal"}
              onSelect={() => patch({ sharing: "equal" })}
            />
            <ChoiceCard
              id="estate-shares-custom"
              title="Different shares"
              nested
              selected={sharing === "custom"}
              onSelect={() => patch({ sharing: "custom" })}
            >
              {sharing === "custom" && (
                <div className="mt-4 space-y-3">
                  {chosen.map((option) => (
                    <div
                      key={option.ref}
                      className="flex items-center justify-between gap-3"
                    >
                      <label
                        htmlFor={`estate-share-${domId(option.ref)}`}
                        className="min-w-0 flex-1 truncate text-[13px] text-ink-2"
                      >
                        {option.name || "Unnamed"}
                      </label>
                      <div className="w-28 flex-none">
                        <DecimalInput
                          id={`estate-share-${domId(option.ref)}`}
                          value={findBeneficiary(rows, option.ref)?.sharePercent}
                          ariaLabel={`${option.name || "Unnamed"} — share of the estate`}
                          suffix="%"
                          onChange={(next) => {
                            const existing = findBeneficiary(rows, option.ref);
                            setRows(
                              setBeneficiary(rows, option.ref, {
                                ...existing,
                                ref: option.ref,
                                sharePercent: next,
                              } as BeneficiaryRow),
                            );
                          }}
                        />
                      </div>
                    </div>
                  ))}
                  {/* Shown, never enforced — nothing on this step is required,
                      and a validation wall here is how a half-answered estate
                      form stops being sent at all. */}
                  <p className="text-[12px] text-ink-4">
                    <ShareTotal total={total} />
                  </p>
                </div>
              )}
            </ChoiceCard>
          </div>
        </StepCard>
      )}

      {/* ── If one of them dies before you ────────────────────────────────── */}
      {chosen.length > 0 && (
        <StepCard>
          <p
            id="estate-predeceased-heading"
            className="mb-4 flex items-center gap-1.5 text-[14px] font-medium text-ink"
          >
            {PREDECEASED_QUESTION}
            <FieldTooltip text="These are two different documents. Passing a share down to that person's own children keeps it in their branch of the family; splitting it between the others does not." />
          </p>
          <div
            className="space-y-3"
            role="radiogroup"
            aria-labelledby="estate-predeceased-heading"
          >
            {INTAKE_PREDECEASED_RULES.map((rule) => (
              <ChoiceCard
                key={rule}
                id={`estate-predeceased-${rule}`}
                title={PREDECEASED_RULE_LABELS[rule]}
                nested
                selected={inheritance.ifPredeceased === rule}
                onSelect={() => patch({ ifPredeceased: rule })}
              />
            ))}
          </div>
        </StepCard>
      )}
    </section>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

/** "Adds up to 95%. 5% still to go." — a running count, not a verdict. */
function ShareTotal({ total }: { total: number | null }) {
  const label = sharePercentLabel(total);
  if (label === null) return null;
  const remaining = 100 - (total ?? 0);
  return (
    <>
      Adds up to <span className="tabular text-ink-3">{label}</span>
      {remaining > 0 && (
        <>
          . <span className="tabular text-ink-3">{sharePercentLabel(remaining)}</span> still
          to go
        </>
      )}
      {remaining < 0 && (
        <>
          {" — "}
          <span className="tabular text-ink-3">{sharePercentLabel(-remaining)}</span> over
        </>
      )}
      .
    </>
  );
}

function AddButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-[var(--radius-sm)] border border-hair px-3 py-1.5 text-[13px] text-ink-2 transition-colors hover:border-accent hover:text-accent"
    >
      {children}
    </button>
  );
}
