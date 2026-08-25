"use client";

import type { IntakeDraft } from "@/lib/intake/schema";
import type {
  IntakeChildDistributionPlan,
  IntakeFiduciaryRole,
} from "@/lib/intake/schema";
import {
  FIDUCIARY_PRIORITY_LABELS,
  FIDUCIARY_ROLE_HELP,
  FIDUCIARY_ROLE_LABELS,
  FIDUCIARY_ROLE_QUESTIONS,
  SUGGESTED_CHILD_DISTRIBUTION_CAVEAT,
  SUGGESTED_CHILD_DISTRIBUTION_TERMS,
  estateHousehold,
  estateSlotsFor,
  findContact,
  findFiduciary,
  namedFiduciaries,
  rolesForName,
  setContact,
  setFiduciary,
  type FiduciarySlot,
} from "@/lib/intake/estate";
import { USPS_STATE_CODES, USPS_STATE_NAMES } from "@/lib/usps-states";
import { FieldTooltip } from "@/components/forms/field-tooltip";
import { inputCls, labelCls, selectCls } from "./card-list";

// ─── Types ───────────────────────────────────────────────────────────────────

export type EstateSlice = IntakeDraft["estate"];

type Estate = NonNullable<EstateSlice>;
type FiduciaryRow = NonNullable<Estate["fiduciaries"]>[number];
type ContactRow = NonNullable<Estate["fiduciaryContacts"]>[number];

export interface EstateStepProps {
  value: EstateSlice;
  onChange: (next: EstateSlice) => void;
  /** The Family step's answers. Read, never re-asked: names, spouse and
   *  children all come from there. */
  family: IntakeDraft["family"];
}

// ─── Shared field primitives ─────────────────────────────────────────────────

function Field({
  id,
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  autoComplete,
  optional,
  help,
  className,
}: {
  id: string;
  label: string;
  value: string | undefined;
  onChange: (next: string | undefined) => void;
  type?: "text" | "tel" | "email";
  placeholder?: string;
  autoComplete?: string;
  optional?: boolean;
  help?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <label htmlFor={id} className={`${labelCls} flex items-center gap-1.5`}>
        {label}
        {optional && <span className="font-normal normal-case text-ink-4">(optional)</span>}
        {help && <FieldTooltip text={help} />}
      </label>
      <input
        id={id}
        type={type}
        className={inputCls}
        value={value ?? ""}
        placeholder={placeholder}
        autoComplete={autoComplete}
        // Empty reads as UNANSWERED everywhere downstream — storing "" would
        // make a cleared field look like a deliberate blank answer to the
        // prune, the review card and the note alike.
        onChange={(e) => onChange(e.target.value || undefined)}
      />
    </div>
  );
}

function SectionHeading({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2
      id={id}
      className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3"
    >
      {children}
    </h2>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[var(--radius-sm)] border border-hair bg-card p-5">
      {children}
    </div>
  );
}

// ─── EstateStep ──────────────────────────────────────────────────────────────

export function EstateStep({ value, onChange, family }: EstateStepProps) {
  const estate: Estate = value ?? {};
  const household = estateHousehold(family);
  const slots = estateSlotsFor(household);
  const fiduciaries = estate.fiduciaries ?? [];
  const named = namedFiduciaries(fiduciaries);

  // ── Slice setters ────────────────────────────────────────────────────────
  const patch = (next: Partial<Estate>) => onChange({ ...estate, ...next });

  function setPrincipal(who: "primary" | "spouse", field: "mobile" | "email", next: string | undefined) {
    const contact = estate.contact ?? {};
    patch({ contact: { ...contact, [who]: { ...contact[who], [field]: next } } });
  }

  function setResidence(field: keyof NonNullable<Estate["residence"]>, next: unknown) {
    patch({
      residence: { ...estate.residence, [field]: next } as Estate["residence"],
    });
  }

  function setName(slot: FiduciarySlot, name: string | undefined) {
    patch({
      fiduciaries: setFiduciary(fiduciaries, slot, {
        ...slot,
        name,
      } as FiduciaryRow),
    });
  }

  function setContactField(
    name: string,
    field: "relationship" | "city" | "phone" | "email",
    next: string | undefined,
  ) {
    const existing = findContact(estate.fiduciaryContacts, name);
    patch({
      fiduciaryContacts: setContact(estate.fiduciaryContacts, name, {
        ...existing,
        name,
        [field]: next,
      } as ContactRow),
    });
  }

  function setPlan(plan: IntakeChildDistributionPlan) {
    patch({
      childrenDistribution: { ...estate.childrenDistribution, plan },
    });
  }

  const residence = estate.residence ?? {};
  const plan = estate.childrenDistribution?.plan;

  return (
    <div className="space-y-8">
      <p className="text-[14px] leading-relaxed text-ink-3">
        These are the details an attorney needs to start drafting your will and
        trust. Nothing here is binding — it’s the starting point for our
        conversation, and you can change any of it later.
      </p>

      {/* ── How to reach you ─────────────────────────────────────────────── */}
      <section aria-labelledby="estate-contact-heading" className="space-y-4">
        <SectionHeading id="estate-contact-heading">How to reach you</SectionHeading>
        <Card>
          <div className="space-y-5">
            <PrincipalFields
              idPrefix="estate-primary"
              name={household.primaryName}
              value={estate.contact?.primary}
              onChange={(field, next) => setPrincipal("primary", field, next)}
            />
            {household.hasSpouse && (
              <div className="border-t border-hair pt-5">
                <PrincipalFields
                  idPrefix="estate-spouse"
                  name={household.spouseName ?? "Your spouse or partner"}
                  value={estate.contact?.spouse}
                  onChange={(field, next) => setPrincipal("spouse", field, next)}
                />
              </div>
            )}
          </div>
        </Card>
      </section>

      {/* ── Home address ─────────────────────────────────────────────────── */}
      <section aria-labelledby="estate-address-heading" className="space-y-4">
        <SectionHeading id="estate-address-heading">Home address</SectionHeading>
        <Card>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-6">
            <Field
              id="estate-address1"
              label="Street address"
              value={residence.addressLine1}
              onChange={(v) => setResidence("addressLine1", v)}
              autoComplete="address-line1"
              className="sm:col-span-6"
            />
            <Field
              id="estate-address2"
              label="Apartment or unit"
              value={residence.addressLine2}
              onChange={(v) => setResidence("addressLine2", v)}
              autoComplete="address-line2"
              optional
              className="sm:col-span-6"
            />
            <Field
              id="estate-city"
              label="City"
              value={residence.city}
              onChange={(v) => setResidence("city", v)}
              autoComplete="address-level2"
              className="sm:col-span-3"
            />
            <div className="sm:col-span-2">
              <label htmlFor="estate-state" className={labelCls}>
                State
              </label>
              <select
                id="estate-state"
                className={selectCls}
                value={residence.state ?? ""}
                onChange={(e) => setResidence("state", e.target.value || undefined)}
              >
                <option value="">Select…</option>
                {USPS_STATE_CODES.map((code) => (
                  <option key={code} value={code}>
                    {USPS_STATE_NAMES[code]}
                  </option>
                ))}
              </select>
            </div>
            <Field
              id="estate-zip"
              label="ZIP"
              value={residence.postalCode}
              onChange={(v) => setResidence("postalCode", v)}
              autoComplete="postal-code"
              className="sm:col-span-1"
            />
          </div>

          {/* The domicile question. Two taps, no default — an unasked question
              must not be recorded as a yes. */}
          <div className="mt-5 border-t border-hair pt-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className={`${labelCls} mb-0 flex items-center gap-1.5 normal-case tracking-normal text-[13px] text-ink-2`}>
                Is this your legal residence?
                <FieldTooltip text="The state you legally call home decides which state's law governs your will and trust. It is usually where you live most of the year — which can differ from a mailing address or a second home." />
              </span>
              <YesNo
                name="estate-legal-residence"
                value={residence.isLegalResidence}
                onChange={(next) => setResidence("isLegalResidence", next)}
              />
            </div>
            {residence.isLegalResidence === false && (
              <Field
                id="estate-legal-residence-note"
                label="Where is your legal residence?"
                value={residence.legalResidenceNote}
                onChange={(v) => setResidence("legalResidenceNote", v)}
                placeholder="e.g. Florida — we spend seven months there"
                className="mt-4"
              />
            )}
          </div>
        </Card>
      </section>

      {/* ── The people you'd name ────────────────────────────────────────── */}
      <section aria-labelledby="estate-people-heading" className="space-y-4">
        <div>
          <SectionHeading id="estate-people-heading">The people you’d name</SectionHeading>
          <p className="mt-2 text-[13px] text-ink-3">
            {household.hasChildren
              ? "If something happened to both of you, these are the people who would step in."
              : "The people who would step in if something happened to you."}
            {" "}
            First names and last names are enough — none of this is final.
          </p>
        </div>

        {/* Anyone already named is offered back as a suggestion: the same
            brother is routinely trustee and executor, and picking him twice
            should be a tap, not a retype. */}
        <datalist id="estate-named-people">
          {named.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>

        <div className="space-y-3">
          {groupByRole(slots).map(([role, roleSlots]) => (
            <Card key={role}>
              <p className="mb-1 flex items-center gap-1.5 text-[14px] font-medium text-ink">
                {FIDUCIARY_ROLE_QUESTIONS[role]}
                <FieldTooltip text={FIDUCIARY_ROLE_HELP[role]} />
              </p>
              <p className="mb-4 text-[12px] uppercase tracking-[0.06em] text-ink-4">
                {FIDUCIARY_ROLE_LABELS[role]}
              </p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {roleSlots.map((slot) => (
                  <div key={slot.priority}>
                    <label
                      htmlFor={`estate-${slot.role}-${slot.priority}`}
                      className={labelCls}
                    >
                      {FIDUCIARY_PRIORITY_LABELS[slot.priority]}
                      {slot.priority === "backup" && (
                        <span className="ml-1 font-normal normal-case text-ink-4">
                          (optional)
                        </span>
                      )}
                    </label>
                    <input
                      id={`estate-${slot.role}-${slot.priority}`}
                      type="text"
                      list="estate-named-people"
                      className={inputCls}
                      placeholder="Full name"
                      value={findFiduciary(fiduciaries, slot)?.name ?? ""}
                      onChange={(e) => setName(slot, e.target.value || undefined)}
                    />
                  </div>
                ))}
              </div>
              {role === "guardian" && household.childNames.length > 0 && (
                <p className="mt-3 text-[12px] text-ink-4">
                  For {formatList(household.childNames)}.
                </p>
              )}
            </Card>
          ))}
        </div>
      </section>

      {/* ── How to reach them ────────────────────────────────────────────── */}
      {named.length > 0 && (
        <section aria-labelledby="estate-people-contact-heading" className="space-y-4">
          <div>
            <SectionHeading id="estate-people-contact-heading">
              How to reach them
            </SectionHeading>
            <p className="mt-2 text-[13px] text-ink-3">
              Whatever you have to hand. We only need enough to get in touch.
            </p>
          </div>
          <div className="space-y-3">
            {named.map((name) => {
              const contact = findContact(estate.fiduciaryContacts, name);
              const id = slugId(name);
              return (
                <Card key={name}>
                  <div className="mb-4">
                    <p className="text-[14px] font-medium text-ink">{name}</p>
                    <p className="mt-0.5 text-[12px] text-ink-4">
                      {rolesForName(fiduciaries, name).join(" · ")}
                    </p>
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Field
                      id={`estate-rel-${id}`}
                      label="Relationship to you"
                      value={contact?.relationship}
                      onChange={(v) => setContactField(name, "relationship", v)}
                      placeholder="e.g. sister"
                    />
                    <Field
                      id={`estate-city-${id}`}
                      label="City"
                      value={contact?.city}
                      onChange={(v) => setContactField(name, "city", v)}
                      placeholder="e.g. Ann Arbor, MI"
                    />
                    <Field
                      id={`estate-phone-${id}`}
                      label="Phone"
                      type="tel"
                      value={contact?.phone}
                      onChange={(v) => setContactField(name, "phone", v)}
                      optional
                    />
                    <Field
                      id={`estate-email-${id}`}
                      label="Email"
                      type="email"
                      value={contact?.email}
                      onChange={(v) => setContactField(name, "email", v)}
                      optional
                    />
                  </div>
                </Card>
              );
            })}
          </div>
        </section>
      )}

      {/* ── How the children receive assets ──────────────────────────────── */}
      {household.hasChildren && (
        <section aria-labelledby="estate-distribution-heading" className="space-y-4">
          <SectionHeading id="estate-distribution-heading">
            How your children receive what you leave them
          </SectionHeading>
          <div className="space-y-3" role="radiogroup" aria-labelledby="estate-distribution-heading">
            <ChoiceCard
              id="estate-plan-suggested"
              selected={plan === "suggested"}
              onSelect={() => setPlan("suggested")}
              title="Use the schedule we suggest"
            >
              <ul className="mt-3 space-y-1.5">
                {SUGGESTED_CHILD_DISTRIBUTION_TERMS.map((term) => (
                  <li key={term} className="flex gap-2 text-[13px] text-ink-2">
                    <span aria-hidden="true" className="text-ink-4">
                      —
                    </span>
                    <span>{term}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-[12px] leading-relaxed text-ink-4">
                {SUGGESTED_CHILD_DISTRIBUTION_CAVEAT}
              </p>
            </ChoiceCard>

            <ChoiceCard
              id="estate-plan-custom"
              selected={plan === "custom"}
              onSelect={() => setPlan("custom")}
              title="Tell us what you'd prefer"
            >
              {plan === "custom" && (
                <div className="mt-3">
                  <label htmlFor="estate-plan-note" className="sr-only">
                    What you’d prefer
                  </label>
                  <textarea
                    id="estate-plan-note"
                    rows={4}
                    className={`${inputCls} resize-y`}
                    placeholder="In your own words — at what ages, in what shares, or anything you'd want a trustee to know."
                    value={estate.childrenDistribution?.note ?? ""}
                    onChange={(e) =>
                      patch({
                        childrenDistribution: {
                          ...estate.childrenDistribution,
                          note: e.target.value || undefined,
                        },
                      })
                    }
                  />
                </div>
              )}
            </ChoiceCard>
          </div>
        </section>
      )}
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function PrincipalFields({
  idPrefix,
  name,
  value,
  onChange,
}: {
  idPrefix: string;
  name: string;
  value: { mobile?: string; email?: string } | undefined;
  onChange: (field: "mobile" | "email", next: string | undefined) => void;
}) {
  return (
    <div>
      <p className="mb-3 text-[14px] font-medium text-ink">{name}</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          id={`${idPrefix}-mobile`}
          label="Mobile"
          type="tel"
          value={value?.mobile}
          onChange={(v) => onChange("mobile", v)}
          autoComplete="tel"
        />
        <Field
          id={`${idPrefix}-email`}
          label="Best email"
          type="email"
          value={value?.email}
          onChange={(v) => onChange("email", v)}
          autoComplete="email"
        />
      </div>
    </div>
  );
}

/** Two-tap yes/no. A segmented pair rather than a checkbox because a checkbox
 *  cannot express "not answered yet", which is the state every one of these
 *  starts in. */
function YesNo({
  name,
  value,
  onChange,
}: {
  name: string;
  value: boolean | undefined;
  onChange: (next: boolean) => void;
}) {
  const cls = (active: boolean) =>
    `rounded-full px-4 py-1.5 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
      active ? "bg-accent-wash font-medium text-accent" : "text-ink-3 hover:text-ink"
    }`;
  return (
    <div
      className="flex items-center gap-0.5 rounded-full border border-hair bg-card-2 p-0.5"
      role="group"
      aria-label={name}
    >
      <button type="button" aria-pressed={value === true} className={cls(value === true)} onClick={() => onChange(true)}>
        Yes
      </button>
      <button type="button" aria-pressed={value === false} className={cls(value === false)} onClick={() => onChange(false)}>
        No
      </button>
    </div>
  );
}

/** A big selectable card. The whole card is the target — on a phone, a 14px
 *  radio dot is not. */
function ChoiceCard({
  id,
  title,
  selected,
  onSelect,
  children,
}: {
  id: string;
  title: string;
  selected: boolean;
  onSelect: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-[var(--radius-sm)] border p-5 transition-colors ${
        selected ? "border-accent bg-accent-wash/30" : "border-hair bg-card"
      }`}
    >
      <button
        type="button"
        id={id}
        role="radio"
        aria-checked={selected}
        onClick={onSelect}
        className="flex w-full items-start gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <span
          aria-hidden="true"
          className={`mt-0.5 flex h-4 w-4 flex-none items-center justify-center rounded-full border ${
            selected ? "border-accent" : "border-hair-2"
          }`}
        >
          {selected && <span className="h-2 w-2 rounded-full bg-accent" />}
        </span>
        <span className="text-[14px] font-medium text-ink">{title}</span>
      </button>
      {children && <div className="pl-7">{children}</div>}
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Slots grouped by role, in slot order, so each role renders as one card with
 *  its first choice and backup side by side. */
function groupByRole(
  slots: readonly FiduciarySlot[],
): [IntakeFiduciaryRole, FiduciarySlot[]][] {
  const byRole = new Map<IntakeFiduciaryRole, FiduciarySlot[]>();
  for (const slot of slots) {
    byRole.set(slot.role, [...(byRole.get(slot.role) ?? []), slot]);
  }
  return [...byRole.entries()];
}

/** "Emma, Jack and Nora" */
function formatList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** A DOM-safe id fragment for a person's name — ids only, never identity. */
function slugId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
