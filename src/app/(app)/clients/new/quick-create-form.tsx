"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import Link from "next/link";
import {
  inputClassName,
  selectClassName,
  fieldLabelClassName,
} from "@/components/forms/input-styles";
import {
  ArrowRightIcon,
  AlertCircleIcon,
  CheckCircleIcon,
  FlowIcon,
  ClipboardCheckIcon,
  SparkleIcon,
} from "@/components/icons";
import { CrmHouseholdPicker } from "@/components/crm-household-picker";
import { StateSelect } from "@/components/state-select";
import { AgeYearField } from "@/components/forms/age-year-field";
import { buildHouseholdName } from "@/lib/crm/household-name";
import { birthYearFromDob } from "@/lib/age-year";
import { USPS_STATE_CODES, USPS_STATE_NAMES } from "@/lib/usps-states";

/**
 * Two-step "Start planning" flow:
 *   1. Either pick an existing CRM household OR check "Create a new household"
 *      and fill in identity (name/DOB, optional spouse) inline. Mirrors the
 *      dual-mode Add Client modal so advisors get the same selector either way.
 *   2. Choose one of four start paths from a 2×2 picker, which reveals only
 *      that path's fields:
 *        - Quick Start: planning fields + residence state + children, then the
 *          quick-start wizard.
 *        - Detailed setup: planning fields, then the guided onboarding wizard.
 *        - AI import / Empty client: no fields — the client is created with
 *          sensible defaults (filing status follows whether the household has a
 *          spouse) and the user lands on document import or the overview.
 *
 * The selected household id can also arrive via `?crmHouseholdId=...` when
 * the user round-trips through /crm/new. That mirror keeps the flow safe to
 * deep-link from the CRM side.
 */

type FilingStatus =
  | "single"
  | "married_joint"
  | "married_separate"
  | "head_of_household";

const FILING_STATUS_OPTIONS: { value: FilingStatus; label: string }[] = [
  { value: "single", label: "Single" },
  { value: "married_joint", label: "Married Filing Jointly" },
  { value: "married_separate", label: "Married Filing Separately" },
  { value: "head_of_household", label: "Head of Household" },
];

const MONTH_OPTIONS: { value: number; label: string }[] = [
  { value: 1, label: "January" },
  { value: 2, label: "February" },
  { value: 3, label: "March" },
  { value: 4, label: "April" },
  { value: 5, label: "May" },
  { value: 6, label: "June" },
  { value: 7, label: "July" },
  { value: 8, label: "August" },
  { value: 9, label: "September" },
  { value: 10, label: "October" },
  { value: 11, label: "November" },
  { value: 12, label: "December" },
];

interface PreviewContact {
  role: "primary" | "spouse" | "dependent" | "other";
  firstName: string;
  lastName: string;
}

interface PreviewHousehold {
  id: string;
  name: string;
  contacts: PreviewContact[];
}

type StartPath = "quick" | "detailed" | "import" | "empty";

function PathCard({
  icon,
  title,
  subtitle,
  selected,
  onSelect,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`flex items-start gap-3 rounded-[var(--radius-sm)] border px-3.5 py-3 text-left transition-colors ${
        selected
          ? "border-accent bg-accent/10"
          : "border-hair bg-card-2 hover:border-ink-4"
      }`}
    >
      <span
        className={`mt-0.5 shrink-0 ${selected ? "text-accent-ink" : "text-ink-3"}`}
        aria-hidden="true"
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] font-semibold text-ink">{title}</span>
        <span className="block text-[12px] text-ink-3">{subtitle}</span>
      </span>
    </button>
  );
}

export default function QuickCreateForm() {
  const router = useRouter();
  const { user } = useUser();
  const searchParams = useSearchParams();
  const queryHouseholdId = searchParams.get("crmHouseholdId");
  const [householdId, setHouseholdId] = useState<string | null>(queryHouseholdId);
  const [preview, setPreview] = useState<PreviewHousehold | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [showSpouse, setShowSpouse] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [path, setPath] = useState<StartPath | null>(null);
  const [residenceState, setResidenceState] = useState<string>("");
  const [children, setChildren] = useState<{ firstName: string; dob: string }[]>([]);

  // Step 1 dual-mode: pick existing household, or create a new one inline.
  const [createNewHousehold, setCreateNewHousehold] = useState(false);
  const [newHouseholdState, setNewHouseholdState] = useState("");
  const [createSpouse, setCreateSpouse] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  // Client DOB is held in state so its birth year is still available to the
  // step-2 retirement-age / life-expectancy year readouts after the step-1
  // identity form unmounts. Empty (e.g. picked an existing household) → the
  // year readout is disabled and only the age shows.
  const [dob, setDob] = useState("");
  const clientBirthYear = birthYearFromDob(dob);

  // Keep state in sync with the URL (so a returnTo bounce from /crm/new
  // pre-selects the freshly created household).
  useEffect(() => {
    if (queryHouseholdId && queryHouseholdId !== householdId) {
      setHouseholdId(queryHouseholdId);
    }
  }, [queryHouseholdId, householdId]);

  // Fetch a lightweight preview so step 2 shows which household we're
  // attached to + whether to default the spouse-fields visibility on.
  useEffect(() => {
    if (!householdId) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setPreviewError(null);
      try {
        const res = await fetch(`/api/crm/households/${householdId}`, {
          headers: { accept: "application/json" },
        });
        if (!res.ok) throw new Error(`Load failed (${res.status})`);
        const json = (await res.json()) as { household: PreviewHousehold };
        if (cancelled) return;
        setPreview(json.household);
        const hasSpouse = json.household.contacts.some((c) => c.role === "spouse");
        setShowSpouse(hasSpouse);
      } catch (err) {
        if (cancelled) return;
        setPreviewError(err instanceof Error ? err.message : "Load failed");
        setPreview(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [householdId]);

  // Create a CRM household + primary (and optional spouse) contact from the
  // step 1 identity fields and return the new household id. Mirrors the Add
  // Client modal's inline-create path, but only collects identity here —
  // contact info gets gathered later in the onboarding wizard.
  async function createHouseholdAndContacts(formEl: HTMLFormElement): Promise<string> {
    if (!user?.id) throw new Error("Not signed in.");
    if (!newHouseholdState) throw new Error("Pick the household's state of residence.");
    const data = new FormData(formEl);
    const firstName = String(data.get("firstName") ?? "").trim();
    const lastName = String(data.get("lastName") ?? "").trim();
    const dateOfBirth = String(data.get("dateOfBirth") ?? "");
    const spouseFirstName = createSpouse ? String(data.get("spouseFirstName") ?? "").trim() : "";
    const spouseLastName = createSpouse ? String(data.get("spouseLastName") ?? "").trim() : "";
    const spouseDob = createSpouse ? String(data.get("spouseDob") ?? "") : "";

    const householdName = buildHouseholdName({ firstName, lastName, spouseFirstName, spouseLastName });

    const hRes = await fetch("/api/crm/households", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: householdName, status: "prospect", advisorId: user.id, state: newHouseholdState }),
    });
    if (!hRes.ok) {
      const j = (await hRes.json().catch(() => ({}))) as { error?: string };
      throw new Error(j.error ?? `Failed to create household (${hRes.status})`);
    }
    const { household } = (await hRes.json()) as { household: { id: string } };

    const pRes = await fetch(`/api/crm/households/${household.id}/contacts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: "primary", firstName, lastName, dateOfBirth, state: newHouseholdState }),
    });
    if (!pRes.ok) {
      const j = (await pRes.json().catch(() => ({}))) as { error?: string };
      throw new Error(j.error ?? `Failed to create primary contact (${pRes.status})`);
    }

    if (createSpouse && spouseFirstName) {
      const spouseBody: Record<string, unknown> = {
        role: "spouse",
        firstName: spouseFirstName,
        lastName: spouseLastName || lastName,
      };
      if (spouseDob) spouseBody.dateOfBirth = spouseDob;
      const sRes = await fetch(`/api/crm/households/${household.id}/contacts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(spouseBody),
      });
      if (!sRes.ok) {
        const j = (await sRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `Failed to create spouse contact (${sRes.status})`);
      }
    }

    return household.id;
  }

  async function onCreateSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      const id = await createHouseholdAndContacts(e.currentTarget);
      setHouseholdId(id);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Create failed");
      setCreating(false);
    }
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!householdId) {
      setError("Pick a CRM household first.");
      return;
    }
    if (!path) {
      setError("Choose how you'd like to start.");
      return;
    }
    setSubmitting(true);
    setError(null);

    // For AI-import / empty paths the planning form is never shown, so we
    // create the client with sensible defaults. Filing status follows whether
    // the linked household has a spouse contact. Everything is editable later.
    const householdHasSpouse =
      preview?.contacts.some((c) => c.role === "spouse") ?? false;

    let payload: Record<string, unknown>;
    if (path === "import" || path === "empty") {
      payload = {
        crmHouseholdId: householdId,
        retirementAge: 65,
        lifeExpectancy: 95,
        filingStatus: householdHasSpouse ? "married_joint" : "single",
      };
    } else {
      const data = new FormData(e.currentTarget);
      payload = {
        crmHouseholdId: householdId,
        retirementAge: Number(data.get("retirementAge")),
        retirementMonth: Number(data.get("retirementMonth") ?? 1),
        lifeExpectancy: Number(data.get("lifeExpectancy")),
        filingStatus: data.get("filingStatus") as FilingStatus,
      };
      if (showSpouse) {
        const spouseRA = data.get("spouseRetirementAge") as string;
        const spouseRM = data.get("spouseRetirementMonth") as string;
        const spouseLE = data.get("spouseLifeExpectancy") as string;
        if (spouseRA) payload.spouseRetirementAge = Number(spouseRA);
        if (spouseRM) payload.spouseRetirementMonth = Number(spouseRM);
        if (spouseLE) payload.spouseLifeExpectancy = Number(spouseLE);
      }
    }

    try {
      const res = await fetch("/api/clients", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(
          typeof j.error === "string" ? j.error : `Create failed (${res.status})`,
        );
      }
      const created = await res.json();

      if (path === "detailed") {
        router.push(`/clients/${created.id}/onboarding/household`);
        return;
      }
      if (path === "import") {
        router.push(`/clients/${created.id}/details/import/new`);
        return;
      }
      if (path === "empty") {
        router.push(`/clients/${created.id}/details`);
        return;
      }
      // Quick Start: best-effort residence + children writes, then enter the
      // wizard. These are non-fatal — the wizard can still set them — so a
      // failure here never strands the (already created) client on this form.
      try {
        if (residenceState) {
          await fetch(`/api/clients/${created.id}/plan-settings`, {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ residenceState }),
          });
        }
        for (const child of children) {
          if (!child.firstName.trim()) continue;
          await fetch(`/api/clients/${created.id}/family-members`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              firstName: child.firstName.trim(),
              relationship: "child",
              dateOfBirth: child.dob || null,
            }),
          });
        }
      } catch {
        // Non-fatal — fall through to the wizard.
      }
      router.push(`/clients/${created.id}/quick-start?step=income`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
      setSubmitting(false);
    }
  }

  // Step 1: link to an existing household OR create a new one inline.
  if (!householdId) {
    return (
      <div className="space-y-5">
        {!createNewHousehold && (
          <CrmHouseholdPicker onSelect={setHouseholdId} hideCreateLink />
        )}

        <div className={createNewHousehold ? "" : "border-t border-hair pt-4"}>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={createNewHousehold}
              onChange={(e) => {
                setCreateNewHousehold(e.target.checked);
                setCreateError(null);
              }}
              className="h-4 w-4 rounded border-hair bg-card-2 text-accent focus:ring-accent"
            />
            <span className="text-[13px] font-medium text-ink-2">Create a new household</span>
          </label>
          {createNewHousehold && (
            <p className="mt-1.5 text-[12px] text-ink-4">
              A new CRM household will be created from the details below.
            </p>
          )}
        </div>

        {createNewHousehold && (
          <form onSubmit={onCreateSubmit} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className={fieldLabelClassName} htmlFor="firstName">
                  First name
                </label>
                <input
                  id="firstName"
                  name="firstName"
                  type="text"
                  required
                  className={inputClassName}
                />
              </div>
              <div>
                <label className={fieldLabelClassName} htmlFor="lastName">
                  Last name
                </label>
                <input
                  id="lastName"
                  name="lastName"
                  type="text"
                  required
                  className={inputClassName}
                />
              </div>
              <div className="sm:col-span-2">
                <label className={fieldLabelClassName} htmlFor="dateOfBirth">
                  Date of birth
                </label>
                <input
                  id="dateOfBirth"
                  name="dateOfBirth"
                  type="date"
                  required
                  min="1910-01-01"
                  value={dob}
                  onChange={(e) => setDob(e.target.value)}
                  className={inputClassName}
                />
              </div>
            </div>

            <div className="border-t border-hair pt-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={createSpouse}
                  onChange={(e) => setCreateSpouse(e.target.checked)}
                  className="h-4 w-4 rounded border-hair bg-card-2 text-accent focus:ring-accent"
                />
                <span className="text-[13px] font-medium text-ink-2">Add spouse</span>
              </label>
              {createSpouse && (
                <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className={fieldLabelClassName} htmlFor="spouseFirstName">
                      Spouse first name
                    </label>
                    <input
                      id="spouseFirstName"
                      name="spouseFirstName"
                      type="text"
                      className={inputClassName}
                    />
                  </div>
                  <div>
                    <label className={fieldLabelClassName} htmlFor="spouseLastName">
                      Spouse last name
                    </label>
                    <input
                      id="spouseLastName"
                      name="spouseLastName"
                      type="text"
                      placeholder="Leave blank to inherit client's"
                      className={inputClassName}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className={fieldLabelClassName} htmlFor="spouseDob">
                      Spouse date of birth
                    </label>
                    <input
                      id="spouseDob"
                      name="spouseDob"
                      type="date"
                      min="1910-01-01"
                      className={inputClassName}
                    />
                  </div>
                </div>
              )}
            </div>

            <div>
              <label className={fieldLabelClassName} htmlFor="newHouseholdState">
                State of residence <span className="text-red-500">*</span>
              </label>
              <StateSelect
                id="newHouseholdState"
                name="newHouseholdState"
                value={newHouseholdState}
                onChange={setNewHouseholdState}
                required
              />
            </div>

            {createError && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-[var(--radius-sm)] border border-crit/30 bg-crit/10 px-3 py-2 text-[13px] text-crit"
              >
                <AlertCircleIcon width={16} height={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                <span>{createError}</span>
              </div>
            )}

            <div className="flex items-center justify-between gap-3 pt-1">
              <Link href="/clients" className="text-[13px] text-ink-3 transition-colors hover:text-ink-2">
                Cancel
              </Link>
              <button
                type="submit"
                disabled={creating}
                className="inline-flex h-10 items-center gap-1.5 rounded-[var(--radius-sm)] bg-accent px-4 text-[13px] font-semibold text-accent-on shadow-[0_1px_0_rgba(0,0,0,0.25)] transition-colors hover:bg-accent-ink disabled:opacity-60"
              >
                {creating ? "Creating…" : "Continue"}
                <ArrowRightIcon width={14} height={14} aria-hidden="true" />
              </button>
            </div>
          </form>
        )}

        {!createNewHousehold && (
          <div className="flex items-center justify-between gap-3 pt-1">
            <Link href="/clients" className="text-[13px] text-ink-3 transition-colors hover:text-ink-2">
              Cancel
            </Link>
          </div>
        )}
      </div>
    );
  }

  const primary = preview?.contacts.find((c) => c.role === "primary");
  const spouse = preview?.contacts.find((c) => c.role === "spouse");
  const householdLabel =
    primary && spouse
      ? `${primary.firstName} & ${spouse.firstName} ${primary.lastName}`
      : primary
        ? `${primary.firstName} ${primary.lastName}`
        : (preview?.name ?? "Selected household");

  const submitLabel = submitting
    ? "Creating…"
    : path === "quick"
      ? "Start Quick Start"
      : path === "detailed"
        ? "Start guided setup"
        : path === "import"
          ? "Continue to import"
          : "Create client";

  // Step 2: path picker + conditional planning fields.
  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3 rounded-[var(--radius-sm)] border border-ok/30 bg-ok/10 px-3 py-2.5 text-[13px] text-ink">
        <CheckCircleIcon width={16} height={16} className="mt-0.5 shrink-0 text-ok" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-ink">CRM household linked</p>
          <p className="text-ink-3">{householdLabel}</p>
        </div>
        <button
          type="button"
          onClick={() => {
            setHouseholdId(null);
            setPreview(null);
            setCreateNewHousehold(false);
            setCreateSpouse(false);
            setCreateError(null);
            setPath(null);
          }}
          className="shrink-0 text-[12px] text-ink-3 transition-colors hover:text-ink-2"
        >
          Change
        </button>
      </div>

      {previewError && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-[var(--radius-sm)] border border-warn/30 bg-warn/10 px-3 py-2 text-[13px] text-ink"
        >
          <AlertCircleIcon width={16} height={16} className="mt-0.5 shrink-0 text-warn" aria-hidden="true" />
          <span>Couldn&apos;t preview household ({previewError}). You can still continue.</span>
        </div>
      )}

      <div className="border-t border-hair pt-4">
        <span className={fieldLabelClassName}>How do you want to start?</span>
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <PathCard
            icon={<FlowIcon width={18} height={18} />}
            title="Quick Start"
            subtitle="Fast retirement intake"
            selected={path === "quick"}
            onSelect={() => setPath("quick")}
          />
          <PathCard
            icon={<ClipboardCheckIcon width={18} height={18} />}
            title="Detailed setup"
            subtitle="Full guided wizard"
            selected={path === "detailed"}
            onSelect={() => setPath("detailed")}
          />
          <PathCard
            icon={<SparkleIcon width={18} height={18} />}
            title="AI import"
            subtitle="Extract from documents"
            selected={path === "import"}
            onSelect={() => setPath("import")}
          />
          <PathCard
            icon={<ArrowRightIcon width={18} height={18} />}
            title="Empty client"
            subtitle="Skip the wizard, start blank"
            selected={path === "empty"}
            onSelect={() => setPath("empty")}
          />
        </div>
      </div>

      {path && (
        <form onSubmit={onSubmit} className="space-y-5 border-t border-hair pt-4">
          {(path === "quick" || path === "detailed") && (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <AgeYearField
                  name="retirementAge"
                  label="Retirement age"
                  required
                  defaultAge={65}
                  min={50}
                  max={85}
                  birthYear={clientBirthYear}
                />

                <div>
                  <label className={fieldLabelClassName} htmlFor="retirementMonth">
                    Retirement month
                  </label>
                  <select
                    id="retirementMonth"
                    name="retirementMonth"
                    defaultValue={1}
                    className={selectClassName}
                  >
                    {MONTH_OPTIONS.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>

                <AgeYearField
                  name="lifeExpectancy"
                  label="Life expectancy"
                  required
                  defaultAge={95}
                  min={1}
                  max={120}
                  birthYear={clientBirthYear}
                />

                <div>
                  <label className={fieldLabelClassName} htmlFor="filingStatus">
                    Filing status
                  </label>
                  <select
                    id="filingStatus"
                    name="filingStatus"
                    defaultValue="single"
                    required
                    className={selectClassName}
                  >
                    {FILING_STATUS_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="border-t border-hair pt-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showSpouse}
                    onChange={(e) => setShowSpouse(e.target.checked)}
                    className="h-4 w-4 rounded border-hair bg-card-2 text-accent focus:ring-accent"
                  />
                  <span className="text-[13px] font-medium text-ink-2">Add spouse planning fields</span>
                </label>
                {showSpouse && (
                  <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label className={fieldLabelClassName} htmlFor="spouseRetirementAge">
                        Spouse retirement age
                      </label>
                      <input
                        id="spouseRetirementAge"
                        name="spouseRetirementAge"
                        type="number"
                        min={50}
                        max={85}
                        defaultValue={65}
                        className={inputClassName}
                      />
                    </div>
                    <div>
                      <label className={fieldLabelClassName} htmlFor="spouseRetirementMonth">
                        Spouse retirement month
                      </label>
                      <select
                        id="spouseRetirementMonth"
                        name="spouseRetirementMonth"
                        defaultValue={1}
                        className={selectClassName}
                      >
                        {MONTH_OPTIONS.map((m) => (
                          <option key={m.value} value={m.value}>
                            {m.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={fieldLabelClassName} htmlFor="spouseLifeExpectancy">
                        Spouse life expectancy
                      </label>
                      <input
                        id="spouseLifeExpectancy"
                        name="spouseLifeExpectancy"
                        type="number"
                        min={1}
                        max={120}
                        defaultValue={95}
                        className={inputClassName}
                      />
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {path === "quick" && (
            <div className="space-y-4">
              <div>
                <label className={fieldLabelClassName} htmlFor="residenceState">
                  State of residence
                </label>
                <select
                  id="residenceState"
                  value={residenceState}
                  onChange={(e) => setResidenceState(e.target.value)}
                  className={selectClassName}
                >
                  <option value="">Select a state…</option>
                  {USPS_STATE_CODES.map((code) => (
                    <option key={code} value={code}>
                      {USPS_STATE_NAMES[code]}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <span className={fieldLabelClassName}>Children (optional)</span>
                  <button
                    type="button"
                    onClick={() => setChildren((c) => [...c, { firstName: "", dob: "" }])}
                    className="text-[12px] font-medium text-accent transition-colors hover:text-accent-deep"
                  >
                    + Add child
                  </button>
                </div>
                {children.length > 0 && (
                  <div className="mt-2 space-y-2">
                    {children.map((child, i) => (
                      <div
                        key={i}
                        className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-center"
                      >
                        <input
                          type="text"
                          aria-label={`Child ${i + 1} first name`}
                          placeholder="First name"
                          value={child.firstName}
                          onChange={(e) =>
                            setChildren((arr) =>
                              arr.map((c, j) => (j === i ? { ...c, firstName: e.target.value } : c)),
                            )
                          }
                          className={inputClassName}
                        />
                        <input
                          type="date"
                          aria-label={`Child ${i + 1} date of birth`}
                          min="1910-01-01"
                          value={child.dob}
                          onChange={(e) =>
                            setChildren((arr) =>
                              arr.map((c, j) => (j === i ? { ...c, dob: e.target.value } : c)),
                            )
                          }
                          className={inputClassName}
                        />
                        <button
                          type="button"
                          onClick={() => setChildren((arr) => arr.filter((_, j) => j !== i))}
                          className="text-[12px] text-ink-3 transition-colors hover:text-crit"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {(path === "import" || path === "empty") && (
            <p className="text-[13px] leading-relaxed text-ink-3">
              {path === "import"
                ? "We'll create the client, then take you to document import to extract their data. Retirement and tax assumptions start at sensible defaults — all editable later."
                : "We'll create a blank client with default assumptions. You can fill in everything from the client's pages whenever you're ready."}
            </p>
          )}

          {error && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-[var(--radius-sm)] border border-crit/30 bg-crit/10 px-3 py-2 text-[13px] text-crit"
            >
              <AlertCircleIcon width={16} height={16} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex items-center justify-between gap-3 pt-1">
            <Link href="/clients" className="text-[13px] text-ink-3 transition-colors hover:text-ink-2">
              Cancel
            </Link>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex h-10 items-center gap-1.5 rounded-[var(--radius-sm)] bg-accent px-4 text-[13px] font-semibold text-accent-on shadow-[0_1px_0_rgba(0,0,0,0.25)] transition-colors hover:bg-accent-ink disabled:opacity-60"
            >
              {submitLabel}
              <ArrowRightIcon width={14} height={14} aria-hidden="true" />
            </button>
          </div>
        </form>
      )}

      {!path && (
        <div className="flex items-center justify-between gap-3 pt-1">
          <Link href="/clients" className="text-[13px] text-ink-3 transition-colors hover:text-ink-2">
            Cancel
          </Link>
        </div>
      )}
    </div>
  );
}
