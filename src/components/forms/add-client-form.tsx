"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { inputClassName, selectClassName, textareaClassName, fieldLabelClassName } from "./input-styles";

export interface ClientFormInitial {
  id: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  retirementAge: number;
  lifeExpectancy: number;
  filingStatus: string;
  /** Spouse first name. Stored in the legacy `spouseName` DB column. */
  spouseName?: string | null;
  spouseLastName?: string | null;
  spouseDob?: string | null;
  spouseRetirementAge?: number | null;
  spouseLifeExpectancy?: number | null;
  email?: string | null;
  address?: string | null;
  spouseEmail?: string | null;
  spouseAddress?: string | null;
}

type FormTab = "details" | "contact";

interface AddClientFormProps {
  mode?: "create" | "edit";
  initial?: ClientFormInitial;
  onSuccess?: () => void;
  onDelete?: () => void;
  onSubmitStateChange?: (state: { canSubmit: boolean; loading: boolean }) => void;
}

function toDateInput(v: string | null | undefined): string {
  if (!v) return "";
  // Accept "YYYY-MM-DD" or ISO — keep first 10 chars
  return String(v).slice(0, 10);
}

export default function AddClientForm({ mode = "create", initial, onSuccess, onSubmitStateChange }: AddClientFormProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSpouse, setShowSpouse] = useState(Boolean(initial?.spouseName || initial?.spouseDob));
  const [activeTab, setActiveTab] = useState<FormTab>("details");

  useEffect(() => {
    onSubmitStateChange?.({ canSubmit: !loading, loading });
  }, [loading, onSubmitStateChange]);

  const isEdit = mode === "edit" && initial;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const form = e.currentTarget;
    const data = new FormData(form);

    const body: Record<string, string | number | null | undefined> = {
      firstName: data.get("firstName") as string,
      lastName: data.get("lastName") as string,
      dateOfBirth: data.get("dateOfBirth") as string,
      retirementAge: Number(data.get("retirementAge")),
      lifeExpectancy: Number(data.get("lifeExpectancy")),
      filingStatus: data.get("filingStatus") as string,
      email: (data.get("email") as string) || null,
      address: (data.get("address") as string) || null,
    };

    if (showSpouse) {
      const spouseName = data.get("spouseName") as string;
      const spouseLastName = data.get("spouseLastName") as string;
      const spouseDob = data.get("spouseDob") as string;
      const spouseRetirementAge = data.get("spouseRetirementAge") as string;
      const spouseLifeExpectancy = data.get("spouseLifeExpectancy") as string;
      const spouseEmail = data.get("spouseEmail") as string;
      const spouseAddress = data.get("spouseAddress") as string;

      body.spouseName = spouseName || null;
      body.spouseLastName = spouseLastName || null;
      body.spouseDob = spouseDob || null;
      body.spouseRetirementAge = spouseRetirementAge ? Number(spouseRetirementAge) : null;
      body.spouseLifeExpectancy = spouseLifeExpectancy ? Number(spouseLifeExpectancy) : null;
      body.spouseEmail = spouseEmail || null;
      body.spouseAddress = spouseAddress || null;
    } else if (isEdit) {
      body.spouseName = null;
      body.spouseLastName = null;
      body.spouseDob = null;
      body.spouseRetirementAge = null;
      body.spouseLifeExpectancy = null;
      body.spouseEmail = null;
      body.spouseAddress = null;
    }

    try {
      const url = isEdit ? `/api/clients/${initial!.id}` : "/api/clients";
      const method = isEdit ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error ?? "Failed to save client");
      }

      router.refresh();
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form id="add-client-form" onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <p className="rounded bg-red-900/50 px-3 py-2 text-sm text-red-400">{error}</p>
      )}

      <nav className="-mt-2 flex gap-1 border-b border-gray-700" role="tablist" aria-label="Client form sections">
        <TabButton active={activeTab === "details"} onClick={() => setActiveTab("details")}>
          Details
        </TabButton>
        <TabButton active={activeTab === "contact"} onClick={() => setActiveTab("contact")}>
          Contact
        </TabButton>
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
          <label className={fieldLabelClassName} htmlFor="lifeExpectancy">
            Life Expectancy <span className="text-red-500">*</span>
          </label>
          <input
            id="lifeExpectancy"
            name="lifeExpectancy"
            type="number"
            min={70}
            max={120}
            defaultValue={initial?.lifeExpectancy ?? 95}
            required
            className={`mt-1 ${inputClassName}`}
          />
          <p className="mt-1 text-[11px] text-gray-500">
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
            className="h-4 w-4 rounded border-gray-600 bg-gray-800 text-blue-600 focus:ring-blue-500"
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
              <label className={fieldLabelClassName} htmlFor="spouseLifeExpectancy">
                Spouse Life Expectancy
              </label>
              <input
                id="spouseLifeExpectancy"
                name="spouseLifeExpectancy"
                type="number"
                min={70}
                max={120}
                defaultValue={initial?.spouseLifeExpectancy ?? 95}
                className={`mt-1 ${inputClassName}`}
              />
            </div>
          </div>
        )}
      </div>
      </div>

      <div role="tabpanel" hidden={activeTab !== "contact"} className="space-y-4">
        <div>
          <h3 className="text-sm font-medium text-gray-300">Client</h3>
          <div className="mt-2 space-y-3">
            <div>
              <label className={fieldLabelClassName} htmlFor="email">Email</label>
              <input
                id="email"
                name="email"
                type="email"
                defaultValue={initial?.email ?? ""}
                className={`mt-1 ${inputClassName}`}
              />
            </div>
            <div>
              <label className={fieldLabelClassName} htmlFor="address">Address</label>
              <textarea
                id="address"
                name="address"
                rows={2}
                defaultValue={initial?.address ?? ""}
                placeholder="Street, City, State ZIP"
                className={`mt-1 ${textareaClassName}`}
              />
            </div>
          </div>
        </div>

        {showSpouse && (
          <div className="border-t border-gray-700 pt-4">
            <h3 className="text-sm font-medium text-gray-300">Spouse</h3>
            <div className="mt-2 space-y-3">
              <div>
                <label className={fieldLabelClassName} htmlFor="spouseEmail">Spouse Email</label>
                <input
                  id="spouseEmail"
                  name="spouseEmail"
                  type="email"
                  defaultValue={initial?.spouseEmail ?? ""}
                  className={`mt-1 ${inputClassName}`}
                />
              </div>
              <div>
                <label className={fieldLabelClassName} htmlFor="spouseAddress">Spouse Address</label>
                <textarea
                  id="spouseAddress"
                  name="spouseAddress"
                  rows={2}
                  defaultValue={initial?.spouseAddress ?? ""}
                  placeholder="Leave blank if same as client"
                  className={`mt-1 ${textareaClassName}`}
                />
              </div>
            </div>
          </div>
        )}
        {!showSpouse && (
          <p className="text-xs text-gray-500">Add a spouse on the Details tab to enter separate spouse contact info.</p>
        )}
      </div>

    </form>
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
          ? "border-blue-500 text-gray-100"
          : "border-transparent text-gray-400 hover:text-gray-200"
      }`}
    >
      {children}
    </button>
  );
}
