"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { inputClassName, selectClassName, fieldLabelClassName } from "./input-styles";
import { useScenarioWriter } from "@/hooks/use-scenario-writer";
import { useTabAutoSave, type SaveResult } from "@/lib/use-tab-auto-save";
import TabAutoSaveIndicator from "../tab-auto-save-indicator";
import { CrmHouseholdPicker } from "@/components/crm-household-picker";
import { buildHouseholdName } from "@/lib/crm/household-name";
import { CheckCircleIcon } from "@/components/icons";
import { StateSelect } from "@/components/state-select";
import { AgeYearField } from "./age-year-field";
import { birthYearFromDob } from "@/lib/age-year";

export interface ClientFormInitial {
  id: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  retirementAge: number;
  retirementMonth?: number | null;
  lifeExpectancy: number;
  filingStatus: string;
  spouseName?: string | null;
  spouseLastName?: string | null;
  spouseDob?: string | null;
  spouseRetirementAge?: number | null;
  spouseRetirementMonth?: number | null;
  spouseLifeExpectancy?: number | null;
  email?: string | null;
  phone?: string | null;
  mobile?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
  spouseEmail?: string | null;
  spousePhone?: string | null;
  spouseMobile?: string | null;
  spouseAddressLine1?: string | null;
  spouseAddressLine2?: string | null;
  spouseCity?: string | null;
  spouseState?: string | null;
  spousePostalCode?: string | null;
  spouseCountry?: string | null;
}

const MONTH_OPTIONS: { value: number; label: string }[] = [
  { value: 1, label: "January" },   { value: 2, label: "February" }, { value: 3, label: "March" },
  { value: 4, label: "April" },     { value: 5, label: "May" },      { value: 6, label: "June" },
  { value: 7, label: "July" },      { value: 8, label: "August" },   { value: 9, label: "September" },
  { value: 10, label: "October" },  { value: 11, label: "November" },{ value: 12, label: "December" },
];

type FormTab = "details" | "contact";

interface AddClientFormProps {
  mode?: "create" | "edit";
  initial?: ClientFormInitial;
  onSuccess?: () => void;
  onSubmitStateChange?: (state: { canSubmit: boolean; loading: boolean }) => void;
  onAutoSaved?: () => void;
}

function toDateInput(v: string | null | undefined): string {
  if (!v) return "";
  return String(v).slice(0, 10);
}

export default function AddClientForm({ initial, onSuccess, onSubmitStateChange, onAutoSaved }: AddClientFormProps) {
  const router = useRouter();
  const { user } = useUser();
  const [effectiveClientId, setEffectiveClientId] = useState<string | null>(initial?.id ?? null);
  const writer = useScenarioWriter(effectiveClientId ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSpouse, setShowSpouse] = useState(Boolean(initial?.spouseName || initial?.spouseDob));
  const [lastName, setLastName] = useState(initial?.lastName ?? "");
  // DOB is controlled so the retirement-age / life-expectancy year readouts
  // recompute live as the birth date is edited in the same form.
  const [dob, setDob] = useState(toDateInput(initial?.dateOfBirth));
  const [spouseDob, setSpouseDob] = useState(toDateInput(initial?.spouseDob));
  const clientBirthYear = birthYearFromDob(dob);
  const spouseBirthYear = birthYearFromDob(spouseDob);
  const [activeTab, setActiveTab] = useState<FormTab>("details");
  const formRef = useRef<HTMLFormElement | null>(null);
  const [dirty, setDirty] = useState(false);
  const [canSave, setCanSave] = useState(true);
  // Create-mode-only: dual-mode household state.
  // Edit mode skips both controls entirely.
  const [selectedHouseholdId, setSelectedHouseholdId] = useState<string | null>(null);
  const [createNewHousehold, setCreateNewHousehold] = useState(false);
  const [householdState, setHouseholdState] = useState("");

  const isEdit = effectiveClientId !== null;
  // In create mode, identity fields (firstName/lastName/DOB) are rendered only
  // when we're creating a new household. In edit mode they're rendered as
  // today (legacy edit form still owns identity until that flow is migrated).
  const showIdentityFields = isEdit || createNewHousehold;

  // canSubmit gating:
  //   edit         -> always (depends on HTML validity)
  //   pick existing -> needs selectedHouseholdId
  //   create new   -> needs the checkbox on + HTML validity
  const householdReady =
    isEdit ||
    (createNewHousehold && householdState !== "") ||
    selectedHouseholdId !== null;

  useEffect(() => {
    onSubmitStateChange?.({ canSubmit: !loading && householdReady && canSave, loading });
  }, [loading, householdReady, canSave, onSubmitStateChange]);

  function buildPlanningBody(formEl: HTMLFormElement, crmHouseholdId: string): Record<string, string | number | null | undefined> {
    const data = new FormData(formEl);
    const body: Record<string, string | number | null | undefined> = {
      crmHouseholdId,
      retirementAge: Number(data.get("retirementAge")),
      retirementMonth: Number(data.get("retirementMonth") ?? 1),
      lifeExpectancy: Number(data.get("lifeExpectancy")),
      filingStatus: data.get("filingStatus") as string,
      email:        (data.get("email") as string)        || null,
      phone:        (data.get("phone") as string)        || null,
      mobile:       (data.get("mobile") as string)       || null,
      addressLine1: (data.get("addressLine1") as string) || null,
      addressLine2: (data.get("addressLine2") as string) || null,
      city:         (data.get("city") as string)         || null,
      state:        (data.get("state") as string)        || null,
      postalCode:   (data.get("postalCode") as string)   || null,
      country:      (data.get("country") as string)      || null,
    };

    // Edit mode still carries identity in the planning row (legacy schema —
    // until that flow is migrated to CRM contacts). Create mode never sends
    // identity here: it either lives on a CRM contact we just made, or on a
    // contact the picked household already owns.
    if (isEdit) {
      body.firstName = data.get("firstName") as string;
      body.lastName = data.get("lastName") as string;
      body.dateOfBirth = data.get("dateOfBirth") as string;
    }

    if (showSpouse) {
      const spouseRetirementAge = data.get("spouseRetirementAge") as string;
      const spouseRetirementMonth = data.get("spouseRetirementMonth") as string;
      const spouseLifeExpectancy = data.get("spouseLifeExpectancy") as string;

      if (isEdit) {
        body.spouseName = (data.get("spouseName") as string) || null;
        body.spouseLastName = (data.get("spouseLastName") as string) || null;
        body.spouseDob = (data.get("spouseDob") as string) || null;
      }
      body.spouseRetirementAge = spouseRetirementAge ? Number(spouseRetirementAge) : null;
      body.spouseRetirementMonth = spouseRetirementMonth ? Number(spouseRetirementMonth) : null;
      body.spouseLifeExpectancy = spouseLifeExpectancy ? Number(spouseLifeExpectancy) : null;
      body.spouseEmail        = (data.get("spouseEmail") as string)        || null;
      body.spousePhone        = (data.get("spousePhone") as string)        || null;
      body.spouseMobile       = (data.get("spouseMobile") as string)       || null;
      body.spouseAddressLine1 = (data.get("spouseAddressLine1") as string) || null;
      body.spouseAddressLine2 = (data.get("spouseAddressLine2") as string) || null;
      body.spouseCity         = (data.get("spouseCity") as string)         || null;
      body.spouseState        = (data.get("spouseState") as string)        || null;
      body.spousePostalCode   = (data.get("spousePostalCode") as string)   || null;
      body.spouseCountry      = (data.get("spouseCountry") as string)      || null;
    } else if (isEdit) {
      body.spouseName = null;
      body.spouseLastName = null;
      body.spouseDob = null;
      body.spouseRetirementAge = null;
      body.spouseRetirementMonth = null;
      body.spouseLifeExpectancy = null;
      body.spouseEmail = null;
      body.spousePhone = null;
      body.spouseMobile = null;
      body.spouseAddressLine1 = null;
      body.spouseAddressLine2 = null;
      body.spouseCity = null;
      body.spouseState = null;
      body.spousePostalCode = null;
      body.spouseCountry = null;
    }
    return body;
  }

  // Create a CRM household + 1-2 contacts from current form values and return
  // the new household id. Called only when the "Create new household" checkbox
  // is checked.
  async function createHouseholdAndContacts(formEl: HTMLFormElement): Promise<string> {
    if (!user?.id) throw new Error("Not signed in.");
    const data = new FormData(formEl);
    const firstName = String(data.get("firstName") ?? "").trim();
    const lastName = String(data.get("lastName") ?? "").trim();
    const dateOfBirth = String(data.get("dateOfBirth") ?? "");
    const spouseFirstName = showSpouse ? String(data.get("spouseName") ?? "").trim() : "";
    const spouseLastName = showSpouse ? String(data.get("spouseLastName") ?? "").trim() : "";
    const spouseDob = showSpouse ? String(data.get("spouseDob") ?? "") : "";

    const householdName = buildHouseholdName({ firstName, lastName, spouseFirstName, spouseLastName });

    // 1. Household
    const hRes = await fetch("/api/crm/households", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: householdName, status: "prospect", advisorId: user.id, state: householdState }),
    });
    if (!hRes.ok) {
      const j = (await hRes.json().catch(() => ({}))) as { error?: string };
      throw new Error(j.error ?? `Failed to create household (${hRes.status})`);
    }
    const { household } = (await hRes.json()) as { household: { id: string } };
    const householdId = household.id;

    // 2. Primary contact. We include the email/phone/address fields from the
    //    Contact tab so the household lands with full identity in one shot.
    const primaryBody: Record<string, unknown> = {
      role: "primary",
      firstName,
      lastName,
      dateOfBirth,
    };
    const email = String(data.get("email") ?? "").trim();
    if (email) primaryBody.email = email;
    const phone = String(data.get("phone") ?? "").trim();
    if (phone) primaryBody.phone = phone;
    const mobile = String(data.get("mobile") ?? "").trim();
    if (mobile) primaryBody.mobile = mobile;
    const addr1 = String(data.get("addressLine1") ?? "").trim();
    if (addr1) primaryBody.addressLine1 = addr1;
    const addr2 = String(data.get("addressLine2") ?? "").trim();
    if (addr2) primaryBody.addressLine2 = addr2;
    const city = String(data.get("city") ?? "").trim();
    if (city) primaryBody.city = city;
    // Household state is authoritative for the primary contact's residence.
    primaryBody.state = householdState;
    const postalCode = String(data.get("postalCode") ?? "").trim();
    if (postalCode) primaryBody.postalCode = postalCode;
    const country = String(data.get("country") ?? "").trim();
    if (country) primaryBody.country = country;

    const pRes = await fetch(`/api/crm/households/${householdId}/contacts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(primaryBody),
    });
    if (!pRes.ok) {
      const j = (await pRes.json().catch(() => ({}))) as { error?: string };
      throw new Error(j.error ?? `Failed to create primary contact (${pRes.status})`);
    }

    // 3. Spouse contact (optional)
    if (showSpouse && spouseFirstName) {
      const spouseBody: Record<string, unknown> = {
        role: "spouse",
        firstName: spouseFirstName,
        lastName: spouseLastName || lastName,
      };
      if (spouseDob) spouseBody.dateOfBirth = spouseDob;
      const sEmail = String(data.get("spouseEmail") ?? "").trim();
      if (sEmail) spouseBody.email = sEmail;
      const sPhone = String(data.get("spousePhone") ?? "").trim();
      if (sPhone) spouseBody.phone = sPhone;
      const sMobile = String(data.get("spouseMobile") ?? "").trim();
      if (sMobile) spouseBody.mobile = sMobile;
      const sAddr1 = String(data.get("spouseAddressLine1") ?? "").trim();
      if (sAddr1) spouseBody.addressLine1 = sAddr1;
      const sAddr2 = String(data.get("spouseAddressLine2") ?? "").trim();
      if (sAddr2) spouseBody.addressLine2 = sAddr2;
      const sCity = String(data.get("spouseCity") ?? "").trim();
      if (sCity) spouseBody.city = sCity;
      const sState = String(data.get("spouseState") ?? "").trim();
      if (sState) spouseBody.state = sState;
      const sPostalCode = String(data.get("spousePostalCode") ?? "").trim();
      if (sPostalCode) spouseBody.postalCode = sPostalCode;
      const sCountry = String(data.get("spouseCountry") ?? "").trim();
      if (sCountry) spouseBody.country = sCountry;

      const sRes = await fetch(`/api/crm/households/${householdId}/contacts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(spouseBody),
      });
      if (!sRes.ok) {
        const j = (await sRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `Failed to create spouse contact (${sRes.status})`);
      }
    }

    return householdId;
  }

  async function saveCore(formEl: HTMLFormElement): Promise<SaveResult & { recordId?: string }> {
    try {
      // Resolve the household id for the planning POST.
      let crmHouseholdId: string;
      if (isEdit) {
        // Edit mode never carries a household id in the body — PUT uses the
        // existing one stored on the row.
        crmHouseholdId = "";
      } else if (createNewHousehold) {
        crmHouseholdId = await createHouseholdAndContacts(formEl);
      } else if (selectedHouseholdId) {
        crmHouseholdId = selectedHouseholdId;
      } else {
        return { ok: false, error: "Pick a household or check 'Create a new household'." };
      }

      const body = buildPlanningBody(formEl, crmHouseholdId);
      // Edit-mode PUT doesn't accept crmHouseholdId in the body; strip it.
      if (isEdit) delete body.crmHouseholdId;

      const res = isEdit
        ? await writer.submit(
            {
              op: "edit",
              targetKind: "client",
              targetId: effectiveClientId!,
              desiredFields: body,
            },
            {
              url: `/api/clients/${effectiveClientId}`,
              method: "PUT",
              body,
            },
          )
        : await fetch("/api/clients", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        return { ok: false, error: json.error ?? "Failed to save client" };
      }
      const json = (await res.json().catch(() => null)) as { id?: string } | null;
      const recordId = json?.id ?? effectiveClientId ?? undefined;
      if (!effectiveClientId && recordId) setEffectiveClientId(recordId);
      setDirty(false);
      return { ok: true, recordId };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const result = await saveCore(e.currentTarget);
    setLoading(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (!isEdit) router.refresh();
    onSuccess?.();
  }

  const autoSave = useTabAutoSave({
    isDirty: dirty,
    canSave,
    saveAsync: async () => {
      const form = formRef.current;
      if (!form) return { ok: true };
      // Don't auto-save on tab switch in create mode if we don't yet have a
      // resolved household. The save would fail and pop a misleading error.
      if (!isEdit && !householdReady) return { ok: true };
      setLoading(true);
      const result = await saveCore(form);
      setLoading(false);
      if (result.ok) onAutoSaved?.();
      return result;
    },
  });

  function handleFormChange() {
    if (!dirty) setDirty(true);
    const form = formRef.current;
    if (form) setCanSave(form.checkValidity());
  }

  function goToTab(next: FormTab) {
    void autoSave.interceptTabChange(next, (id) => setActiveTab(id as FormTab));
  }

  return (
    <form
      id="add-client-form"
      ref={formRef}
      onSubmit={handleSubmit}
      onChange={handleFormChange}
      className="space-y-4"
    >
      {error && (
        <p className="rounded bg-red-900/50 px-3 py-2 text-sm text-red-400">{error}</p>
      )}

      <nav className="-mt-2 flex items-center justify-between border-b border-gray-700" role="tablist" aria-label="Client form sections">
        <div className="flex gap-1">
          <TabButton active={activeTab === "details"} onClick={() => goToTab("details")}>Details</TabButton>
          <TabButton active={activeTab === "contact"} onClick={() => goToTab("contact")}>Contact</TabButton>
        </div>
        <div className="pr-2">
          <TabAutoSaveIndicator
            saving={autoSave.saving}
            error={autoSave.saveError}
            onDismissError={autoSave.clearSaveError}
          />
        </div>
      </nav>

      <div role="tabpanel" hidden={activeTab !== "details"} className="space-y-4">

        {/* Create mode: household picker / create-new toggle. Edit mode hides
            this block — identity already lives in CRM under the existing
            household and the form only edits planning fields. */}
        {!isEdit && (
          <div className="space-y-3 rounded-md border border-gray-700 bg-gray-800/40 p-3">
            {!selectedHouseholdId && !createNewHousehold && (
              <CrmHouseholdPicker
                onSelect={(id) => setSelectedHouseholdId(id)}
                hideCreateLink
              />
            )}

            {selectedHouseholdId && (
              <div className="flex items-start gap-3 rounded-md border border-emerald-700/40 bg-emerald-900/20 px-3 py-2 text-sm">
                <CheckCircleIcon width={16} height={16} className="mt-0.5 shrink-0 text-emerald-400" aria-hidden="true" />
                <span className="flex-1 text-gray-100">CRM household linked.</span>
                <button
                  type="button"
                  onClick={() => setSelectedHouseholdId(null)}
                  className="text-xs text-gray-300 hover:text-gray-100"
                >
                  Change
                </button>
              </div>
            )}

            <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-200">
              <input
                type="checkbox"
                checked={createNewHousehold}
                disabled={!!selectedHouseholdId}
                onChange={(e) => setCreateNewHousehold(e.target.checked)}
                className="h-4 w-4 rounded border-gray-600 bg-gray-800 text-accent focus:ring-accent"
              />
              <span>Create a new household</span>
            </label>
            {createNewHousehold && (
              <div className="space-y-2">
                <div>
                  <label className={fieldLabelClassName} htmlFor="householdState">
                    State of residence <span className="text-red-500">*</span>
                  </label>
                  <StateSelect
                    id="householdState"
                    name="householdState"
                    value={householdState}
                    onChange={setHouseholdState}
                    required
                    className={`mt-1 ${selectClassName}`}
                  />
                </div>
                <p className="text-xs text-gray-400">
                  A new CRM household will be created from the details below. Drives
                  state income &amp; estate tax for the plan.
                </p>
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          {showIdentityFields && (
            <>
              <div>
                <label className={fieldLabelClassName} htmlFor="firstName">
                  First Name <span className="text-red-500">*</span>
                </label>
                <input id="firstName" name="firstName" type="text" required defaultValue={initial?.firstName ?? ""} className={`mt-1 ${inputClassName}`} />
              </div>

              <div>
                <label className={fieldLabelClassName} htmlFor="lastName">
                  Last Name <span className="text-red-500">*</span>
                </label>
                <input id="lastName" name="lastName" type="text" required value={lastName} onChange={(e) => setLastName(e.target.value)} className={`mt-1 ${inputClassName}`} />
              </div>

              <div>
                <label className={fieldLabelClassName} htmlFor="dateOfBirth">
                  Date of Birth <span className="text-red-500">*</span>
                </label>
                <input id="dateOfBirth" name="dateOfBirth" type="date" required min="1910-01-01" value={dob} onChange={(e) => setDob(e.target.value)} className={`mt-1 ${inputClassName}`} />
              </div>
            </>
          )}

          <div>
            <label className={fieldLabelClassName} htmlFor="filingStatus">
              Filing Status <span className="text-red-500">*</span>
            </label>
            <select id="filingStatus" name="filingStatus" required defaultValue={initial?.filingStatus ?? "single"} className={`mt-1 ${selectClassName}`}>
              <option value="single">Single</option>
              <option value="married_joint">Married Filing Jointly</option>
              <option value="married_separate">Married Filing Separately</option>
              <option value="head_of_household">Head of Household</option>
            </select>
          </div>

          <AgeYearField
            name="retirementAge"
            label="Retirement Age"
            required
            defaultAge={initial?.retirementAge ?? 65}
            min={50}
            max={85}
            birthYear={clientBirthYear}
          />

          <div>
            <label className={fieldLabelClassName} htmlFor="retirementMonth">Retirement Month</label>
            <select id="retirementMonth" name="retirementMonth" defaultValue={initial?.retirementMonth ?? 1} className={`mt-1 ${selectClassName}`}>
              {MONTH_OPTIONS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
            <p className="mt-1 text-xs text-gray-400">
              Income/expenses linked to retirement are pro-rated for this month in the retirement year.
            </p>
          </div>

          <AgeYearField
            name="lifeExpectancy"
            label="Life Expectancy"
            required
            defaultAge={initial?.lifeExpectancy ?? 95}
            min={1}
            max={120}
            birthYear={clientBirthYear}
            hint={
              <p className="text-xs text-gray-400">
                Plan horizon ends the year of the last spouse to die.
              </p>
            }
          />
        </div>

        <div className="border-t border-gray-700 pt-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={showSpouse}
              onChange={(e) => setShowSpouse(e.target.checked)}
              className="h-4 w-4 rounded border-gray-600 bg-gray-800 text-accent focus:ring-accent"
            />
            <span className="text-sm font-medium text-gray-300">Add Spouse</span>
          </label>

          {showSpouse && (
            <div className="mt-3 grid grid-cols-2 gap-4">
              {showIdentityFields && (
                <>
                  <div>
                    <label className={fieldLabelClassName} htmlFor="spouseName">Spouse First Name</label>
                    <input id="spouseName" name="spouseName" type="text" defaultValue={initial?.spouseName ?? ""} className={`mt-1 ${inputClassName}`} />
                  </div>

                  <div>
                    <label className={fieldLabelClassName} htmlFor="spouseLastName">Spouse Last Name</label>
                    <input id="spouseLastName" name="spouseLastName" type="text" placeholder="Leave blank to inherit client's" defaultValue={initial?.spouseLastName ?? lastName} className={`mt-1 ${inputClassName}`} />
                  </div>

                  <div>
                    <label className={fieldLabelClassName} htmlFor="spouseDob">Spouse Date of Birth</label>
                    <input id="spouseDob" name="spouseDob" type="date" min="1910-01-01" value={spouseDob} onChange={(e) => setSpouseDob(e.target.value)} className={`mt-1 ${inputClassName}`} />
                  </div>
                </>
              )}

              <AgeYearField
                name="spouseRetirementAge"
                label="Spouse Retirement Age"
                defaultAge={initial?.spouseRetirementAge ?? 65}
                min={50}
                max={85}
                birthYear={spouseBirthYear}
              />

              <div>
                <label className={fieldLabelClassName} htmlFor="spouseRetirementMonth">Spouse Retirement Month</label>
                <select id="spouseRetirementMonth" name="spouseRetirementMonth" defaultValue={initial?.spouseRetirementMonth ?? 1} className={`mt-1 ${selectClassName}`}>
                  {MONTH_OPTIONS.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </div>

              <AgeYearField
                name="spouseLifeExpectancy"
                label="Spouse Life Expectancy"
                defaultAge={initial?.spouseLifeExpectancy ?? 95}
                min={1}
                max={120}
                birthYear={spouseBirthYear}
              />
            </div>
          )}
        </div>
      </div>

      <div role="tabpanel" hidden={activeTab !== "contact"} className="space-y-6">
        <ContactInfoSection heading="Client" initial={initial} prefix="" />
        {showSpouse ? (
          <div className="border-t border-gray-700 pt-4">
            <ContactInfoSection heading="Spouse" initial={initial} prefix="spouse" />
          </div>
        ) : (
          <p className="text-xs text-gray-400">
            Add a spouse on the Details tab to enter separate spouse contact info.
          </p>
        )}
      </div>
    </form>
  );
}

function ContactInfoSection({
  heading, initial, prefix,
}: { heading: string; initial?: ClientFormInitial; prefix: "" | "spouse" }) {
  const fieldName = (base: string) =>
    prefix === "" ? base : `${prefix}${base[0].toUpperCase()}${base.slice(1)}`;
  const v = (base: string) =>
    (initial?.[fieldName(base) as keyof ClientFormInitial] as string | null | undefined) ?? "";

  return (
    <div>
      <h3 className="text-sm font-medium text-gray-300">{heading}</h3>
      <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2">
        <ContactInput label="Email"       name={fieldName("email")}       type="email" defaultValue={v("email")} />
        <ContactInput label="Phone"       name={fieldName("phone")}       type="tel"   defaultValue={v("phone")} />
        <ContactInput label="Mobile"      name={fieldName("mobile")}      type="tel"   defaultValue={v("mobile")} />
        <ContactInput label="Address line 1" name={fieldName("addressLine1")}          defaultValue={v("addressLine1")} className="md:col-span-2" />
        <ContactInput label="Address line 2" name={fieldName("addressLine2")}          defaultValue={v("addressLine2")} className="md:col-span-2" />
        <ContactInput label="City"        name={fieldName("city")}                     defaultValue={v("city")} />
        <ContactInput label="State"       name={fieldName("state")}                    defaultValue={v("state")} />
        <ContactInput label="Postal code" name={fieldName("postalCode")}               defaultValue={v("postalCode")} />
        <ContactInput label="Country"     name={fieldName("country")}                  defaultValue={v("country")} />
      </div>
    </div>
  );
}

function ContactInput({
  label, name, type = "text", defaultValue, className,
}: { label: string; name: string; type?: string; defaultValue?: string; className?: string }) {
  return (
    <div className={className}>
      <label className={fieldLabelClassName} htmlFor={name}>{label}</label>
      <input id={name} name={name} type={type} defaultValue={defaultValue ?? ""} className={`mt-1 ${inputClassName}`} />
    </div>
  );
}

function TabButton({
  active, onClick, children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
        active ? "border-accent text-gray-100" : "border-transparent text-gray-300 hover:text-gray-200"
      }`}
    >
      {children}
    </button>
  );
}
