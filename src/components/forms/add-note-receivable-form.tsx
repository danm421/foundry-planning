"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import type { SaveResult } from "@/lib/use-tab-auto-save";
import type { YearRef, ClientMilestones } from "@/lib/milestones";
import { resolveMilestone } from "@/lib/milestones";
import MilestoneYearPicker from "../milestone-year-picker";
import { CurrencyInput } from "@/components/currency-input";
import { PercentInput } from "@/components/percent-input";
import {
  fieldLabelClassName,
  inputBaseClassName,
  inputClassName,
  selectClassName,
} from "./input-styles";
import { OwnershipEditor } from "./ownership-editor";
import type { AccountOwner } from "@/engine/ownership";
import { buildNoteReceivableSchedule } from "@/engine/notes-receivable";
import type { NoteReceivable } from "@/engine/notes-receivable";

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export interface NoteReceivableFormInitial {
  id: string;
  name: string;
  faceValue: number;
  basis: number;
  asOfBalance?: number;
  balanceAsOfMonth?: number;
  balanceAsOfYear?: number;
  interestRate: number;
  paymentType: "amortizing" | "interest_only_balloon";
  monthlyPayment?: number;
  startYear: number;
  startMonth: number;
  termMonths: number;
  startYearRef?: string | null;
  linkedTrustEntityId?: string | null;
  owners: AccountOwner[];
  extraPayments: Array<{
    id?: string;
    year: number;
    type: "per_payment" | "lump_sum";
    amount: number;
  }>;
}

export interface AddNoteReceivableFormProps {
  clientId: string;
  entities?: { id: string; name: string }[];
  familyMembers?: {
    id: string;
    role: "client" | "spouse" | "child" | "other";
    firstName: string;
  }[];
  milestones?: ClientMilestones;
  clientFirstName?: string;
  spouseFirstName?: string;
  mode?: "create" | "edit";
  initial?: NoteReceivableFormInitial;
  onSuccess?: () => void;
  onSubmitStateChange?: (state: { canSubmit: boolean; loading: boolean }) => void;
  onAutoSaveStateChange?: (state: { isDirty: boolean; canSave: boolean }) => void;
  onAutoSaved?: (recordId: string) => void;
}

export interface NoteReceivableFormAutoSaveHandle {
  saveAsync: () => Promise<SaveResult & { recordId?: string }>;
}

type TabId = "details" | "amortization" | "extra-payments";

const AddNoteReceivableForm = forwardRef<
  NoteReceivableFormAutoSaveHandle,
  AddNoteReceivableFormProps
>(function AddNoteReceivableForm(
  {
    clientId,
    entities = [],
    familyMembers = [],
    milestones,
    mode = "create",
    initial,
    onSuccess,
    onSubmitStateChange,
    onAutoSaveStateChange,
    onAutoSaved,
  },
  ref,
) {
  const router = useRouter();
  const isEdit = mode === "edit" && !!initial;
  const currentYear = new Date().getFullYear();

  const [activeTab, setActiveTab] = useState<TabId>("details");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    onSubmitStateChange?.({ canSubmit: !loading, loading });
  }, [loading, onSubmitStateChange]);

  // ── Form state ───────────────────────────────────────────────────────────
  const [name, setName] = useState(initial?.name ?? "");
  const [nameInvalid, setNameInvalid] = useState(false);
  const [faceValue, setFaceValue] = useState<string>(
    initial?.faceValue != null ? String(initial.faceValue) : "0",
  );
  const [basis, setBasis] = useState<string>(
    initial?.basis != null ? String(initial.basis) : "0",
  );
  // Track whether the user has manually edited basis. When false, basis
  // mirrors faceValue (the common case for non-installment notes).
  const basisTouchedRef = useRef<boolean>(
    !!initial && Number(initial.basis) !== Number(initial.faceValue),
  );

  const [asOfBalance, setAsOfBalance] = useState<string>(
    initial?.asOfBalance != null ? String(initial.asOfBalance) : "",
  );
  const [balanceAsOfMonth, setBalanceAsOfMonth] = useState<number>(
    initial?.balanceAsOfMonth ?? new Date().getMonth() + 1,
  );
  const [balanceAsOfYear, setBalanceAsOfYear] = useState<number>(
    initial?.balanceAsOfYear ?? currentYear,
  );

  const initialInterestPct = initial
    ? Math.round(Number(initial.interestRate) * 10000) / 100
    : 0;
  const [interestRatePct, setInterestRatePct] = useState<string>(
    String(initialInterestPct),
  );

  const [paymentType, setPaymentType] = useState<
    "amortizing" | "interest_only_balloon"
  >(initial?.paymentType ?? "amortizing");
  const [monthlyPayment, setMonthlyPayment] = useState<string>(
    initial?.monthlyPayment != null ? String(initial.monthlyPayment) : "",
  );

  const [startYearRef, setStartYearRef] = useState<YearRef | null>(
    (initial?.startYearRef as YearRef) ??
      (!isEdit ? ("plan_start" as YearRef) : null),
  );
  const [startYear, setStartYear] = useState<number>(
    initial?.startYear ??
      (startYearRef && milestones
        ? (resolveMilestone(startYearRef, milestones, "start") ?? currentYear)
        : currentYear),
  );
  const [startMonth, setStartMonth] = useState<number>(initial?.startMonth ?? 1);
  const [termMonths, setTermMonths] = useState<string>(
    initial?.termMonths != null ? String(initial.termMonths) : "120",
  );

  const [linkedTrustEntityId, setLinkedTrustEntityId] = useState<string>(
    initial?.linkedTrustEntityId ?? "",
  );

  const clientFm = familyMembers.find((fm) => fm.role === "client");
  const defaultOwners: AccountOwner[] = clientFm
    ? [{ kind: "family_member", familyMemberId: clientFm.id, percent: 1 }]
    : [];
  const [owners, setOwners] = useState<AccountOwner[]>(
    initial?.owners && initial.owners.length > 0 ? initial.owners : defaultOwners,
  );

  const [extraPayments, setExtraPayments] = useState(
    initial?.extraPayments ?? [],
  );

  function addExtraPayment() {
    setExtraPayments((prev) => [
      ...prev,
      { year: currentYear, type: "lump_sum" as const, amount: 0 },
    ]);
  }

  function updateExtraPayment(
    idx: number,
    patch: Partial<{
      year: number;
      type: "per_payment" | "lump_sum";
      amount: number;
    }>,
  ) {
    setExtraPayments((prev) =>
      prev.map((ep, i) => (i === idx ? { ...ep, ...patch } : ep)),
    );
  }

  function removeExtraPayment(idx: number) {
    setExtraPayments((prev) => prev.filter((_, i) => i !== idx));
  }

  const [effectiveNoteId, setEffectiveNoteId] = useState<string | null>(
    initial?.id ?? null,
  );

  // Auto-focus name input on create
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (isEdit) return;
    nameInputRef.current?.focus();
    nameInputRef.current?.select();
  }, [isEdit]);

  // Sync basis ← faceValue while user hasn't touched basis
  useEffect(() => {
    if (basisTouchedRef.current) return;
    setBasis(faceValue);
  }, [faceValue]);

  function handleBasisChange(next: string) {
    basisTouchedRef.current = true;
    setBasis(next);
  }

  // ── Validation ────────────────────────────────────────────────────────────
  const faceValueNum = parseFloat(faceValue) || 0;
  const basisNum = parseFloat(basis) || 0;
  const termMonthsNum = parseInt(termMonths) || 0;
  const ownerSum = owners.reduce((acc, o) => acc + o.percent, 0);
  const ownersValid = Math.abs(ownerSum - 1) < 0.0001;

  const canSave =
    name.trim().length > 0 &&
    faceValueNum > 0 &&
    basisNum >= 0 &&
    termMonthsNum > 0 &&
    ownersValid;

  // ── Save ──────────────────────────────────────────────────────────────────
  function buildBody() {
    const interestRate = (parseFloat(interestRatePct) || 0) / 100;
    const mp = parseFloat(monthlyPayment);
    return {
      name: name.trim(),
      faceValue: faceValueNum,
      basis: basisNum,
      asOfBalance: asOfBalance === "" ? null : parseFloat(asOfBalance),
      balanceAsOfMonth: asOfBalance === "" ? null : balanceAsOfMonth,
      balanceAsOfYear: asOfBalance === "" ? null : balanceAsOfYear,
      interestRate,
      paymentType,
      monthlyPayment: isFinite(mp) && monthlyPayment !== "" ? mp : null,
      startYear,
      startMonth,
      startYearRef,
      termMonths: termMonthsNum,
      linkedTrustEntityId: linkedTrustEntityId || null,
      owners: owners.map((o) => ({
        familyMemberId: o.kind === "family_member" ? o.familyMemberId : null,
        entityId: o.kind === "entity" ? o.entityId : null,
        externalBeneficiaryId:
          o.kind === "external_beneficiary"
            ? o.externalBeneficiaryId
            : null,
        percent: o.percent,
      })),
      extraPayments: extraPayments.map((ep) => ({
        year: ep.year,
        type: ep.type,
        amount: ep.amount,
      })),
    };
  }

  async function saveExtraPayments(noteId: string) {
    const res = await fetch(
      `/api/clients/${clientId}/notes-receivable/${noteId}/extra-payments`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          extraPayments.map((ep) => ({
            year: ep.year,
            type: ep.type,
            amount: ep.amount,
          })),
        ),
      },
    );
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(json.error ?? "Failed to save extra payments");
    }
  }

  async function saveCore(): Promise<SaveResult & { recordId?: string }> {
    if (!canSave) {
      return { ok: false, error: "Required fields missing or invalid." };
    }
    const body = buildBody();
    try {
      if (effectiveNoteId) {
        // PATCH note + (separately) PATCH extra payments
        const res = await fetch(
          `/api/clients/${clientId}/notes-receivable/${effectiveNoteId}`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          },
        );
        if (!res.ok) {
          const json = (await res.json().catch(() => ({}))) as { error?: string };
          return { ok: false, error: json.error ?? "Failed to save note" };
        }
        await saveExtraPayments(effectiveNoteId);
        lastSavedSnapshotRef.current = JSON.stringify(body);
        return { ok: true, recordId: effectiveNoteId };
      }
      // POST creates note + owners + extra payments in one transaction
      const res = await fetch(`/api/clients/${clientId}/notes-receivable`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        return { ok: false, error: json.error ?? "Failed to create note" };
      }
      const json = (await res.json().catch(() => null)) as { id?: string } | null;
      const recordId = json?.id;
      if (recordId) setEffectiveNoteId(recordId);
      lastSavedSnapshotRef.current = JSON.stringify(body);
      return { ok: true, recordId };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "Unknown error",
      };
    }
  }

  const lastSavedSnapshotRef = useRef<string>(JSON.stringify(buildBody()));
  const isDirty = JSON.stringify(buildBody()) !== lastSavedSnapshotRef.current;

  useEffect(() => {
    onAutoSaveStateChange?.({ isDirty, canSave });
  }, [isDirty, canSave, onAutoSaveStateChange]);

  useImperativeHandle(
    ref,
    () => ({
      saveAsync: async () => {
        if (!canSave) {
          setNameInvalid(name.trim().length === 0);
          return { ok: false, error: "Required fields missing or invalid." };
        }
        setLoading(true);
        const result = await saveCore();
        setLoading(false);
        if (result.ok && result.recordId && !effectiveNoteId) {
          onAutoSaved?.(result.recordId);
        }
        return result;
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      canSave,
      name,
      faceValue,
      basis,
      asOfBalance,
      balanceAsOfMonth,
      balanceAsOfYear,
      interestRatePct,
      paymentType,
      monthlyPayment,
      startYear,
      startMonth,
      startYearRef,
      termMonths,
      linkedTrustEntityId,
      owners,
      extraPayments,
      effectiveNoteId,
    ],
  );

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (name.trim().length === 0) {
      setNameInvalid(true);
      return;
    }
    if (!canSave) {
      setError("Required fields missing or invalid.");
      return;
    }
    setLoading(true);
    setError(null);
    const result = await saveCore();
    setLoading(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.refresh();
    onSuccess?.();
  }

  // ── Tab buttons ──────────────────────────────────────────────────────────
  function tabButtonClass(id: TabId) {
    return activeTab === id
      ? "border-b-2 border-accent px-3 py-1.5 text-sm text-white"
      : "border-b-2 border-transparent px-3 py-1.5 text-sm text-gray-400 hover:text-gray-200";
  }

  // ── Trust filter for linked-trust dropdown ───────────────────────────────
  // We don't have entityType on the lite entity shape passed in; show all
  // for now. Future polish: filter to trusts when the prop carries it.
  const trustEntities = entities;

  // ── Amortization preview ─────────────────────────────────────────────────
  // Build a NoteReceivable from current form state and run the engine's
  // schedule builder. Returns an empty array when inputs are insufficient.
  const previewSchedule = useMemo(() => {
    if (faceValueNum <= 0 || termMonthsNum <= 0) return [];
    const previewNote: NoteReceivable = {
      id: effectiveNoteId ?? "preview",
      name: name || "Preview",
      faceValue: faceValueNum,
      basis: basisNum,
      asOfBalance: asOfBalance === "" ? undefined : parseFloat(asOfBalance),
      balanceAsOfMonth: asOfBalance === "" ? undefined : balanceAsOfMonth,
      balanceAsOfYear: asOfBalance === "" ? undefined : balanceAsOfYear,
      interestRate: (parseFloat(interestRatePct) || 0) / 100,
      paymentType,
      monthlyPayment:
        monthlyPayment !== "" && isFinite(parseFloat(monthlyPayment))
          ? parseFloat(monthlyPayment)
          : undefined,
      startYear,
      startMonth,
      termMonths: termMonthsNum,
      extraPayments: extraPayments.map((ep, i) => ({
        id: ep.id ?? `tmp-${i}`,
        noteReceivableId: effectiveNoteId ?? "preview",
        year: ep.year,
        type: ep.type,
        amount: ep.amount,
      })),
      owners: [],
    };
    return buildNoteReceivableSchedule(previewNote);
  }, [
    effectiveNoteId,
    name,
    faceValueNum,
    basisNum,
    asOfBalance,
    balanceAsOfMonth,
    balanceAsOfYear,
    interestRatePct,
    paymentType,
    monthlyPayment,
    startYear,
    startMonth,
    termMonthsNum,
    extraPayments,
  ]);

  function formatCurrency(n: number): string {
    return n.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    });
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <nav className="flex gap-1 border-b border-gray-700">
        <button
          type="button"
          className={tabButtonClass("details")}
          onClick={() => setActiveTab("details")}
        >
          Details
        </button>
        <button
          type="button"
          className={tabButtonClass("amortization")}
          onClick={() => setActiveTab("amortization")}
        >
          Amortization
        </button>
        <button
          type="button"
          className={tabButtonClass("extra-payments")}
          onClick={() => setActiveTab("extra-payments")}
        >
          Extra Payments
        </button>
      </nav>

      {error && (
        <p className="rounded bg-red-900/50 px-3 py-2 text-sm text-red-400">
          {error}
        </p>
      )}

      {/* Single <form> wraps every tab so the dialog's primaryAction.form
          submit hook can fire from any tab. Tab panels are conditionally
          shown so React's tab state persists across switches. */}
      <form
        id="add-note-receivable-form"
        onSubmit={handleSubmit}
        className="space-y-4"
      >
        {activeTab === "details" && (
          <div className="space-y-4">
            {/* Name */}
            <div>
              <label htmlFor="nr-name" className={fieldLabelClassName}>
                Name
              </label>
              <input
                id="nr-name"
                ref={nameInputRef}
                type="text"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (nameInvalid && e.target.value.trim().length > 0) {
                    setNameInvalid(false);
                  }
                }}
                className={
                  nameInvalid
                    ? `${inputBaseClassName} border-red-500`
                    : inputClassName
                }
                placeholder="e.g. Note from Smith Family Trust"
              />
            </div>

            {/* Face value + Cost basis */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="nr-face" className={fieldLabelClassName}>
                  Face value
                </label>
                <CurrencyInput
                  id="nr-face"
                  value={faceValue}
                  onChange={setFaceValue}
                  className={inputClassName}
                />
              </div>
              <div>
                <label htmlFor="nr-basis" className={fieldLabelClassName}>
                  Cost basis
                </label>
                <CurrencyInput
                  id="nr-basis"
                  value={basis}
                  onChange={handleBasisChange}
                  className={inputClassName}
                />
                <p className="mt-1 text-xs text-gray-500">
                  Lower than face value only if this is an installment sale of
                  an appreciated asset.
                </p>
              </div>
            </div>

            {/* Current balance + as-of date */}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label htmlFor="nr-balance" className={fieldLabelClassName}>
                  Current balance
                </label>
                <CurrencyInput
                  id="nr-balance"
                  value={asOfBalance}
                  onChange={setAsOfBalance}
                  className={inputClassName}
                  placeholder="(optional)"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Leave blank if the note starts on the start date below.
                </p>
              </div>
              <div>
                <label
                  htmlFor="nr-balance-month"
                  className={fieldLabelClassName}
                >
                  Balance as-of month
                </label>
                <select
                  id="nr-balance-month"
                  value={balanceAsOfMonth}
                  onChange={(e) => setBalanceAsOfMonth(Number(e.target.value))}
                  disabled={asOfBalance === ""}
                  className={selectClassName}
                >
                  {MONTH_NAMES.map((m, i) => (
                    <option key={m} value={i + 1}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label
                  htmlFor="nr-balance-year"
                  className={fieldLabelClassName}
                >
                  Balance as-of year
                </label>
                <input
                  id="nr-balance-year"
                  type="number"
                  value={balanceAsOfYear}
                  onChange={(e) => setBalanceAsOfYear(Number(e.target.value))}
                  disabled={asOfBalance === ""}
                  className={inputClassName}
                />
              </div>
            </div>

            {/* Interest rate + Payment type + Monthly payment */}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label htmlFor="nr-rate" className={fieldLabelClassName}>
                  Interest rate
                </label>
                <PercentInput
                  id="nr-rate"
                  value={interestRatePct}
                  onChange={setInterestRatePct}
                  className={inputClassName}
                />
              </div>
              <div>
                <label htmlFor="nr-paytype" className={fieldLabelClassName}>
                  Payment type
                </label>
                <select
                  id="nr-paytype"
                  value={paymentType}
                  onChange={(e) =>
                    setPaymentType(
                      e.target.value as "amortizing" | "interest_only_balloon",
                    )
                  }
                  className={selectClassName}
                >
                  <option value="amortizing">Amortizing</option>
                  <option value="interest_only_balloon">
                    Interest-only + balloon
                  </option>
                </select>
              </div>
              <div>
                <label htmlFor="nr-mpay" className={fieldLabelClassName}>
                  Monthly payment
                </label>
                <CurrencyInput
                  id="nr-mpay"
                  value={monthlyPayment}
                  onChange={setMonthlyPayment}
                  className={inputClassName}
                  placeholder="(auto)"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Leave blank to compute from face value, rate, and term.
                </p>
              </div>
            </div>

            {/* Start date + Term */}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className={fieldLabelClassName}>Start year</label>
                {milestones ? (
                  <MilestoneYearPicker
                    name="startYear"
                    id="nr-start-year"
                    value={startYear}
                    yearRef={startYearRef}
                    milestones={milestones}
                    showSSRefs={false}
                    onChange={(yr, ref) => {
                      setStartYear(yr);
                      setStartYearRef(ref);
                    }}
                    label=""
                  />
                ) : (
                  <input
                    id="nr-start-year"
                    type="number"
                    value={startYear}
                    onChange={(e) => {
                      setStartYear(Number(e.target.value));
                      setStartYearRef(null);
                    }}
                    className={inputClassName}
                  />
                )}
              </div>
              <div>
                <label htmlFor="nr-start-month" className={fieldLabelClassName}>
                  Start month
                </label>
                <select
                  id="nr-start-month"
                  value={startMonth}
                  onChange={(e) => setStartMonth(Number(e.target.value))}
                  className={selectClassName}
                >
                  {MONTH_NAMES.map((m, i) => (
                    <option key={m} value={i + 1}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="nr-term" className={fieldLabelClassName}>
                  Term (months)
                </label>
                <input
                  id="nr-term"
                  type="number"
                  min={1}
                  value={termMonths}
                  onChange={(e) => setTermMonths(e.target.value)}
                  className={inputClassName}
                />
              </div>
            </div>

            {/* Linked trust */}
            {trustEntities.length > 0 && (
              <div>
                <label htmlFor="nr-trust" className={fieldLabelClassName}>
                  Linked trust (optional)
                </label>
                <select
                  id="nr-trust"
                  value={linkedTrustEntityId}
                  onChange={(e) => setLinkedTrustEntityId(e.target.value)}
                  className={selectClassName}
                >
                  <option value="">— None —</option>
                  {trustEntities.map((ent) => (
                    <option key={ent.id} value={ent.id}>
                      {ent.name}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-gray-500">
                  Used by sale-to-IDGT scenarios to associate the note with the
                  buying trust.
                </p>
              </div>
            )}

            {/* Ownership */}
            <div>
              <OwnershipEditor
                familyMembers={familyMembers}
                entities={entities}
                value={owners}
                onChange={setOwners}
                titlingType="jtwros"
                onTitlingTypeChange={() => {}}
                label="Ownership"
              />
              {!ownersValid && (
                <p className="mt-1 text-xs text-red-400">
                  Owner percentages must sum to 100%.
                </p>
              )}
            </div>
          </div>
        )}

        {activeTab === "amortization" && (
          <div>
            {previewSchedule.length === 0 ? (
              <p className="rounded border border-gray-700 p-4 text-sm text-gray-400">
                Enter a face value and term on the Details tab to see the
                amortization schedule.
              </p>
            ) : (
              <div className="max-h-[28rem] overflow-y-auto rounded border border-gray-700">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-gray-900 text-left text-xs uppercase text-gray-400">
                    <tr>
                      <th className="px-3 py-2">Year</th>
                      <th className="px-3 py-2 text-right">Payment</th>
                      <th className="px-3 py-2 text-right">Interest</th>
                      <th className="px-3 py-2 text-right">Principal</th>
                      <th className="px-3 py-2 text-right">Ending balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewSchedule.map((row) => (
                      <tr
                        key={row.year}
                        className="border-t border-gray-800 text-gray-200"
                      >
                        <td className="px-3 py-1.5">{row.year}</td>
                        <td className="px-3 py-1.5 text-right">
                          {formatCurrency(row.scheduledPayment)}
                        </td>
                        <td className="px-3 py-1.5 text-right">
                          {formatCurrency(row.interest)}
                        </td>
                        <td className="px-3 py-1.5 text-right">
                          {formatCurrency(row.principal)}
                        </td>
                        <td className="px-3 py-1.5 text-right">
                          {formatCurrency(row.endingBalance)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {activeTab === "extra-payments" && (
          <div className="space-y-3">
            <p className="text-xs text-gray-400">
              Lump-sum payments are applied in addition to scheduled monthly
              payments and shorten the term. Per-payment additions are added to
              every monthly payment that year.
            </p>
            {extraPayments.length === 0 ? (
              <p className="rounded border border-dashed border-gray-700 p-4 text-sm text-gray-400">
                No extra payments yet.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-gray-400">
                  <tr>
                    <th className="px-2 py-1.5">Year</th>
                    <th className="px-2 py-1.5">Type</th>
                    <th className="px-2 py-1.5 text-right">Amount</th>
                    <th className="px-2 py-1.5" />
                  </tr>
                </thead>
                <tbody>
                  {extraPayments.map((ep, idx) => (
                    <tr
                      key={idx}
                      className="border-t border-gray-800 align-middle"
                    >
                      <td className="px-2 py-1.5">
                        <input
                          type="number"
                          min={1900}
                          max={2200}
                          value={ep.year}
                          onChange={(e) =>
                            updateExtraPayment(idx, {
                              year: Number(e.target.value),
                            })
                          }
                          className={`${inputBaseClassName} w-24`}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <select
                          value={ep.type}
                          onChange={(e) =>
                            updateExtraPayment(idx, {
                              type: e.target.value as
                                | "per_payment"
                                | "lump_sum",
                            })
                          }
                          className={selectClassName}
                        >
                          <option value="lump_sum">Lump sum</option>
                          <option value="per_payment">Per payment</option>
                        </select>
                      </td>
                      <td className="px-2 py-1.5">
                        <CurrencyInput
                          value={String(ep.amount)}
                          onChange={(v) =>
                            updateExtraPayment(idx, {
                              amount: parseFloat(v) || 0,
                            })
                          }
                          className={inputClassName}
                        />
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <button
                          type="button"
                          onClick={() => removeExtraPayment(idx)}
                          className="text-xs text-gray-400 hover:text-red-400"
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <button
              type="button"
              onClick={addExtraPayment}
              className="rounded border border-gray-600 px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-800"
            >
              + Add extra payment
            </button>
          </div>
        )}
      </form>
    </div>
  );
});

export default AddNoteReceivableForm;
