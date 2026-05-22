"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { inputClassName, selectClassName, fieldLabelClassName } from "./input-styles";
import { useScenarioWriter } from "@/hooks/use-scenario-writer";
import { useTabAutoSave, type SaveResult } from "@/lib/use-tab-auto-save";
import TabAutoSaveIndicator from "../tab-auto-save-indicator";

export interface ClientFormInitial {
  id: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  retirementAge: number;
  retirementMonth?: number | null;
  lifeExpectancy: number;
  filingStatus: string;
  /** Spouse first name. Stored in the legacy `spouseName` DB column. */
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

type FormTab = "details" | "contact";

interface AddClientFormProps {
  mode?: "create" | "edit";
  initial?: ClientFormInitial;
  onSuccess?: () => void;
  onSubmitStateChange?: (state: { canSubmit: boolean; loading: boolean }) => void;
  /** Fires when an auto-save on tab switch creates or updates the client.
   *  The dialog uses this to refresh the parent on close. */
  onAutoSaved?: () => void;
}

function toDateInput(v: string | null | undefined): string {
  if (!v) return "";
  // Accept "YYYY-MM-DD" or ISO — keep first 10 chars
  return String(v).slice(0, 10);
}

export default function AddClientForm({ initial, onSuccess, onSubmitStateChange, onAutoSaved }: AddClientFormProps) {
  const router = useRouter();
  // After an auto-save POSTs a brand-new client, subsequent saves route
  // against the returned id. We can't mutate the `writer` (which is bound to
  // initial?.id), but the create path doesn't go through the writer anyway —
  // it uses raw fetch — so we patch the URL inside saveCore() based on this.
  const [effectiveClientId, setEffectiveClientId] = useState<string | null>(initial?.id ?? null);
  const writer = useScenarioWriter(effectiveClientId ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSpouse, setShowSpouse] = useState(Boolean(initial?.spouseName || initial?.spouseDob));
  const [activeTab, setActiveTab] = useState<FormTab>("details");
  const formRef = useRef<HTMLFormElement | null>(null);
  // Dirty-tracking for tab-switch auto-save. We track at the form level via
  // `onChange` so we don't have to convert every input to controlled state.
  const [dirty, setDirty] = useState(false);
  const [canSave, setCanSave] = useState(true);

  useEffect(() => {
    onSubmitStateChange?.({ canSubmit: !loading, loading });
  }, [loading, onSubmitStateChange]);

  // After auto-save in create mode, effectiveClientId is set and we route
  // subsequent saves through PUT instead of POST.
  const isEdit = effectiveClientId !== null;

  // Build the request body from current FormData. Shared by the explicit-save
  // submit handler and the auto-save-on-tab-switch path so both produce the
  // same payload shape.
  function buildBody(formEl: HTMLFormElement): Record<string, string | number | null | undefined> {
    const data = new FormData(formEl);
    const body: Record<string, string | number | null | undefined> = {
      firstName: data.get("firstName") as string,
      lastName: data.get("lastName") as string,
      dateOfBirth: data.get("dateOfBirth") as string,
      retirementAge: Number(data.get("retirementAge")),
      retirementMonth: Number(data.get("retirementMonth") ?? 1),
      lifeExpectancy: Number(data.get("lifeExpectancy")),
      filingStatus: data.get("filingStatus") as string,
      email:        (data.get("email") as string) || null,
      phone:        (data.get("phone") as string) || null,
      mobile:       (data.get("mobile") as string) || null,
      addressLine1: (data.get("addressLine1") as string) || null,
      addressLine2: (data.get("addressLine2") as string) || null,
      city:         (data.get("city") as string) || null,
      state:        (data.get("state") as string) || null,
      postalCode:   (data.get("postalCode") as string) || null,
      country:      (data.get("country") as string) || null,
    };

    if (showSpouse) {
      const spouseName = data.get("spouseName") as string;
      const spouseLastName = data.get("spouseLastName") as string;
      const spouseDob = data.get("spouseDob") as string;
      const spouseRetirementAge = data.get("spouseRetirementAge") as string;
      const spouseRetirementMonth = data.get("spouseRetirementMonth") as string;
      const spouseLifeExpectancy = data.get("spouseLifeExpectancy") as string;

      body.spouseName = spouseName || null;
      body.spouseLastName = spouseLastName || null;
      body.spouseDob = spouseDob || null;
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

  // Pure save: writes through the writer (PUT) when we already have an id,
  // otherwise POSTs via raw fetch (matches existing behavior). Returns a
  // SaveResult plus the recordId so the auto-save path can promote ADD→EDIT.
  async function saveCore(formEl: HTMLFormElement): Promise<SaveResult & { recordId?: string }> {
    const body = buildBody(formEl);
    try {
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
    // Edit path: writer auto-refreshes. Create path: manual refresh.
    if (!isEdit) router.refresh();
    onSuccess?.();
  }

  const autoSave = useTabAutoSave({
    isDirty: dirty,
    canSave,
    saveAsync: async () => {
      const form = formRef.current;
      if (!form) return { ok: true };
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
          <TabButton active={activeTab === "details"} onClick={() => goToTab("details")}>
            Details
          </TabButton>
          <TabButton active={activeTab === "contact"} onClick={() => goToTab("contact")}>
            Contact
          </TabButton>
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
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={fieldLabelClassName} htmlFor="firstName">
            First Name <span className="text-red-500">*</span>
          </label>
          <input
            id="firstName"
            name="firstName"
            type="text"
            required
            defaultValue={initial?.firstName ?? ""}
            className={`mt-1 ${inputClassName}`}
          />
        </div>

        <div>
          <label className={fieldLabelClassName} htmlFor="lastName">
            Last Name <span className="text-red-500">*</span>
          </label>
          <input
            id="lastName"
            name="lastName"
            type="text"
            required
            defaultValue={initial?.lastName ?? ""}
            className={`mt-1 ${inputClassName}`}
          />
        </div>

        <div>
          <label className={fieldLabelClassName} htmlFor="dateOfBirth">
            Date of Birth <span className="text-red-500">*</span>
          </label>
          <input
            id="dateOfBirth"
            name="dateOfBirth"
            type="date"
            required
            min="1910-01-01"
            defaultValue={toDateInput(initial?.dateOfBirth)}
            className={`mt-1 ${inputClassName}`}
          />
        </div>

        <div>
          <label className={fieldLabelClassName} htmlFor="filingStatus">
            Filing Status <span className="text-red-500">*</span>
          </label>
          <select
            id="filingStatus"
            name="filingStatus"
            required
            defaultValue={initial?.filingStatus ?? "single"}
            className={`mt-1 ${selectClassName}`}
          >
            <option value="single">Single</option>
            <option value="married_joint">Married Filing Jointly</option>
            <option value="married_separate">Married Filing Separately</option>
            <option value="head_of_household">Head of Household</option>
          </select>
        </div>

        <div>
          <label className={fieldLabelClassName} htmlFor="retirementAge">
            Retirement Age <span className="text-red-500">*</span>
          </label>
          <input
            id="retirementAge"
            name="retirementAge"
            type="number"
            min={50}
            max={85}
            defaultValue={initial?.retirementAge ?? 65}
            required
            className={`mt-1 ${inputClassName}`}
          />
        </div>

        <div>
          <label className={fieldLabelClassName} htmlFor="retirementMonth">
            Retirement Month
          </label>
          <select
            id="retirementMonth"
            name="retirementMonth"
            defaultValue={initial?.retirementMonth ?? 1}
            className={`mt-1 ${selectClassName}`}
          >
            {MONTH_OPTIONS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-gray-400">
            Income/expenses linked to retirement are pro-rated for this month in the retirement year.
          </p>
        </div>

        <div>
          <label className={fieldLabelClassName} htmlFor="lifeExpectancy">
            Life Expectancy <span className="text-red-500">*</span>
          </label>
          <input
            id="lifeExpectancy"
            name="lifeExpectancy"
            type="number"
            min={1}
            max={120}
            defaultValue={initial?.lifeExpectancy ?? 95}
            required
            className={`mt-1 ${inputClassName}`}
          />
          <p className="mt-1 text-xs text-gray-400">
            Plan horizon ends the year of the last spouse to die.
          </p>
        </div>
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
            <div>
              <label className={fieldLabelClassName} htmlFor="spouseName">
                Spouse First Name
              </label>
              <input
                id="spouseName"
                name="spouseName"
                type="text"
                defaultValue={initial?.spouseName ?? ""}
                className={`mt-1 ${inputClassName}`}
              />
            </div>

            <div>
              <label className={fieldLabelClassName} htmlFor="spouseLastName">
                Spouse Last Name
              </label>
              <input
                id="spouseLastName"
                name="spouseLastName"
                type="text"
                placeholder="Leave blank to inherit client's"
                defaultValue={initial?.spouseLastName ?? ""}
                className={`mt-1 ${inputClassName}`}
              />
            </div>

            <div>
              <label className={fieldLabelClassName} htmlFor="spouseDob">
                Spouse Date of Birth
              </label>
              <input
                id="spouseDob"
                name="spouseDob"
                type="date"
                min="1910-01-01"
                defaultValue={toDateInput(initial?.spouseDob)}
                className={`mt-1 ${inputClassName}`}
              />
            </div>

            <div>
              <label className={fieldLabelClassName} htmlFor="spouseRetirementAge">
                Spouse Retirement Age
              </label>
              <input
                id="spouseRetirementAge"
                name="spouseRetirementAge"
                type="number"
                min={50}
                max={85}
                defaultValue={initial?.spouseRetirementAge ?? ""}
                className={`mt-1 ${inputClassName}`}
              />
            </div>

            <div>
              <label className={fieldLabelClassName} htmlFor="spouseRetirementMonth">
                Spouse Retirement Month
              </label>
              <select
                id="spouseRetirementMonth"
                name="spouseRetirementMonth"
                defaultValue={initial?.spouseRetirementMonth ?? 1}
                className={`mt-1 ${selectClassName}`}
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
                Spouse Life Expectancy
              </label>
              <input
                id="spouseLifeExpectancy"
                name="spouseLifeExpectancy"
                type="number"
                min={1}
                max={120}
                defaultValue={initial?.spouseLifeExpectancy ?? 95}
                className={`mt-1 ${inputClassName}`}
              />
            </div>
          </div>
        )}
      </div>
      </div>

      <div role="tabpanel" hidden={activeTab !== "contact"} className="space-y-6">
        <ContactInfoSection
          heading="Client"
          initial={initial}
          prefix=""
        />
        {showSpouse ? (
          <div className="border-t border-gray-700 pt-4">
            <ContactInfoSection
              heading="Spouse"
              initial={initial}
              prefix="spouse"
            />
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
  heading,
  initial,
  prefix,
}: {
  heading: string;
  initial?: ClientFormInitial;
  prefix: "" | "spouse";
}) {
  // Field-name helpers: primary uses "email", spouse uses "spouseEmail".
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
      <input
        id={name}
        name={name}
        type={type}
        defaultValue={defaultValue ?? ""}
        className={`mt-1 ${inputClassName}`}
      />
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
        active
          ? "border-accent text-gray-100"
          : "border-transparent text-gray-300 hover:text-gray-200"
      }`}
    >
      {children}
    </button>
  );
}
