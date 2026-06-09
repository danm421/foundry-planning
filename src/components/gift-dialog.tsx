"use client";

import { useMemo, useState } from "react";
import DialogShell from "@/components/dialog-shell";
import type {
  Gift,
  GiftSeriesLite,
  FamilyMember,
  ExternalBeneficiary,
  Entity,
  AccountLite,
} from "@/components/family-view";

type Grantor = "client" | "spouse" | "joint";
type Frequency = "one_time" | "recurring";
type Funding = "cash" | "asset";
type AmountMode = "fixed" | "annual_exclusion";

export interface GiftDialogProps {
  clientId: string;
  scenarioId: string;
  hasSpouse: boolean;
  members: FamilyMember[];
  externals: ExternalBeneficiary[];
  entities: Entity[];
  accounts: AccountLite[];
  annualExclusionByYear: Record<number, number>;
  /** Existing one-time gift to edit, or existing series to edit, or null to add. */
  editingGift?: Gift | null;
  editingSeries?: GiftSeriesLite | null;
  onClose: () => void;
  onSavedGift: (g: Gift) => void;
  onSavedSeries: (s: GiftSeriesLite) => void;
}

// Combined recipient option value, e.g. "entity:<id>" | "family:<id>" | "external:<id>".
type RecipientValue = `${"entity" | "family" | "external"}:${string}`;

export default function GiftDialog(props: GiftDialogProps) {
  const trusts = useMemo(
    () => props.entities.filter((e) => e.entityType === "trust" && e.isIrrevocable === true),
    [props.entities],
  );
  // Household-owned accounts only (exclude entity-owned) for the in-kind source.
  const householdAccounts = useMemo(
    () => props.accounts.filter((a) => a.ownerEntityId == null),
    [props.accounts],
  );

  const editing = props.editingGift ?? props.editingSeries ?? null;
  const isSeries = props.editingSeries != null;

  const [frequency, setFrequency] = useState<Frequency>(isSeries ? "recurring" : "one_time");
  const [grantor, setGrantor] = useState<Grantor>(editing?.grantor ?? "client");
  const [funding, setFunding] = useState<Funding>(props.editingGift?.accountId ? "asset" : "cash");
  const [amountMode, setAmountMode] = useState<AmountMode>(
    props.editingSeries?.amountMode ?? "fixed",
  );

  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState<number>(props.editingGift?.year ?? thisYear);
  const [startYear, setStartYear] = useState<number>(props.editingSeries?.startYear ?? thisYear);
  const [endYear, setEndYear] = useState<number>(props.editingSeries?.endYear ?? thisYear + 9);
  const [amount, setAmount] = useState<string>(
    props.editingGift?.amount != null ? String(props.editingGift.amount) : "0",
  );
  const [annualAmount, setAnnualAmount] = useState<string>(
    props.editingSeries?.annualAmount != null ? String(props.editingSeries.annualAmount) : "0",
  );
  const [percent, setPercent] = useState<string>(
    props.editingGift?.percent != null ? String(props.editingGift.percent * 100) : "0",
  );
  const [accountId, setAccountId] = useState<string>(props.editingGift?.accountId ?? "");
  const [inflationAdjust, setInflationAdjust] = useState<boolean>(
    props.editingSeries?.inflationAdjust ?? false,
  );
  const [crummey, setCrummey] = useState<boolean>(editing?.useCrummeyPowers ?? false);
  const [recipient, setRecipient] = useState<RecipientValue | "">(initialRecipient());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function initialRecipient(): RecipientValue | "" {
    if (props.editingSeries) return `entity:${props.editingSeries.recipientEntityId}`;
    const g = props.editingGift;
    if (g?.recipientEntityId) return `entity:${g.recipientEntityId}`;
    if (g?.recipientFamilyMemberId) return `family:${g.recipientFamilyMemberId}`;
    if (g?.recipientExternalBeneficiaryId) return `external:${g.recipientExternalBeneficiaryId}`;
    return "";
  }

  const grantorCount = grantor === "joint" ? 2 : 1;
  const recurring = frequency === "recurring";
  const recipientIsTrust = recipient.startsWith("entity:");

  // Recurring + in-kind both require an irrevocable-trust recipient.
  const requireTrust = recurring || funding === "asset";

  const exclusionThisYear = props.annualExclusionByYear[recurring ? startYear : year] ?? 19_000;
  const maxExclusionHint = (exclusionThisYear * grantorCount).toLocaleString();

  async function save() {
    setSaving(true);
    setError(null);
    try {
      if (!recipient) throw new Error("Please select a recipient.");
      if (requireTrust && !recipientIsTrust) {
        throw new Error("Recurring and in-kind gifts must go to an irrevocable trust.");
      }

      if (recurring) {
        if (endYear < startYear) throw new Error("End year must be ≥ start year.");
        const entityId = recipient.slice("entity:".length);
        const computedAnnual =
          amountMode === "annual_exclusion"
            ? exclusionThisYear * grantorCount
            : Number(annualAmount);
        const body = {
          grantor,
          recipientEntityId: entityId,
          amountMode,
          startYear,
          endYear,
          annualAmount: computedAnnual,
          inflationAdjust: amountMode === "annual_exclusion" ? false : inflationAdjust,
          useCrummeyPowers: crummey,
        };
        const url = props.editingSeries
          ? `/api/clients/${props.clientId}/gifts/series/${props.editingSeries.id}?scenario=${props.scenarioId}`
          : `/api/clients/${props.clientId}/gifts/series?scenario=${props.scenarioId}`;
        const res = await fetch(url, {
          method: props.editingSeries ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
        const row = await res.json();
        props.onSavedSeries({
          id: row.id,
          grantor: row.grantor,
          recipientEntityId: row.recipientEntityId,
          startYear: row.startYear,
          endYear: row.endYear,
          annualAmount: typeof row.annualAmount === "string" ? parseFloat(row.annualAmount) : row.annualAmount,
          amountMode: row.amountMode ?? "fixed",
          inflationAdjust: row.inflationAdjust,
          useCrummeyPowers: row.useCrummeyPowers,
        });
        return;
      }

      // One-time gift
      const body: Record<string, unknown> = { year, grantor, useCrummeyPowers: recipientIsTrust ? crummey : false };
      const [kind, refId] = recipient.split(":");
      if (kind === "entity") body.recipientEntityId = refId;
      if (kind === "family") body.recipientFamilyMemberId = refId;
      if (kind === "external") body.recipientExternalBeneficiaryId = refId;

      if (funding === "asset") {
        if (!accountId) throw new Error("Please select an asset to transfer.");
        const pct = Number(percent) / 100;
        if (!(pct > 0 && pct <= 1)) throw new Error("Percent must be between 0 and 100.");
        body.accountId = accountId;
        body.percent = pct;
      } else {
        body.amount =
          amountMode === "annual_exclusion" ? exclusionThisYear * grantorCount : Number(amount);
      }

      const url = props.editingGift
        ? `/api/clients/${props.clientId}/gifts/${props.editingGift.id}`
        : `/api/clients/${props.clientId}/gifts`;
      const res = await fetch(url, {
        method: props.editingGift ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
      const row = await res.json();
      props.onSavedGift({
        id: row.id,
        year: row.year,
        amount: row.amount != null ? (typeof row.amount === "string" ? parseFloat(row.amount) : row.amount) : null,
        grantor: row.grantor,
        recipientEntityId: row.recipientEntityId ?? null,
        recipientFamilyMemberId: row.recipientFamilyMemberId ?? null,
        recipientExternalBeneficiaryId: row.recipientExternalBeneficiaryId ?? null,
        accountId: row.accountId ?? null,
        percent: row.percent != null ? (typeof row.percent === "string" ? parseFloat(row.percent) : row.percent) : null,
        useCrummeyPowers: row.useCrummeyPowers,
        notes: row.notes ?? null,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <DialogShell
      open
      onOpenChange={(o) => { if (!o) props.onClose(); }}
      title={editing ? "Edit gift" : "Add a gift"}
      size="md"
      primaryAction={{ label: editing ? "Save gift" : "Add gift", onClick: save, loading: saving }}
    >
      <div className="space-y-4 text-sm">
        {/* Frequency */}
        <Field label="Frequency">
          <Segmented
            value={frequency}
            options={[["one_time", "One-time"], ["recurring", "Recurring"]]}
            onChange={(v) => setFrequency(v as Frequency)}
          />
        </Field>

        {/* Year / Start-End */}
        {recurring ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start year"><NumberInput value={startYear} onChange={setStartYear} /></Field>
            <Field label="End year"><NumberInput value={endYear} onChange={setEndYear} /></Field>
          </div>
        ) : (
          <Field label="Year"><NumberInput value={year} onChange={setYear} /></Field>
        )}

        {/* Grantor */}
        <Field label="Grantor">
          <select
            data-testid="grantor"
            value={grantor}
            onChange={(e) => setGrantor(e.target.value as Grantor)}
            className={selectCls}
          >
            <option value="client">Client</option>
            {props.hasSpouse && <option value="spouse">Spouse</option>}
            {props.hasSpouse && <option value="joint">Both (split gift)</option>}
          </select>
          {grantor === "joint" && (
            <p className="mt-1 text-xs text-ink-3">
              Treated as half from each spouse — uses both annual exclusions / Crummey powers.
            </p>
          )}
        </Field>

        {/* Funding (one-time only) */}
        {!recurring && (
          <Field label="Funding">
            <Segmented
              value={funding}
              options={[["cash", "Cash"], ["asset", "Specific asset"]]}
              onChange={(v) => setFunding(v as Funding)}
            />
          </Field>
        )}

        {/* Amount controls */}
        {funding === "asset" && !recurring ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Asset">
              <select data-testid="account" value={accountId} onChange={(e) => setAccountId(e.target.value)} className={selectCls}>
                <option value="">— select —</option>
                {householdAccounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Percent (%)"><NumberInput value={Number(percent)} onChange={(n) => setPercent(String(n))} /></Field>
          </div>
        ) : (
          <Field label="Amount">
            <Segmented
              value={amountMode}
              options={[["fixed", "Fixed $"], ["annual_exclusion", "Max annual exclusion"]]}
              onChange={(v) => setAmountMode(v as AmountMode)}
            />
            {amountMode === "fixed" ? (
              recurring ? (
                <NumberInput className="mt-2" value={Number(annualAmount)} onChange={(n) => setAnnualAmount(String(n))} />
              ) : (
                <NumberInput className="mt-2" value={Number(amount)} onChange={(n) => setAmount(String(n))} />
              )
            ) : (
              <p className="mt-2 text-xs text-ink-3" data-testid="exclusion-hint">
                ≈ ${maxExclusionHint}/yr{grantor === "joint" ? " (both spouses)" : ""}
              </p>
            )}
            {recurring && amountMode === "fixed" && (
              <label className="mt-2 flex items-center gap-2 text-xs text-ink-2">
                <input type="checkbox" checked={inflationAdjust} onChange={(e) => setInflationAdjust(e.target.checked)} />
                Inflation-adjust each year
              </label>
            )}
          </Field>
        )}

        {/* Recipient */}
        <Field label="Recipient">
          <select data-testid="recipient" value={recipient} onChange={(e) => setRecipient(e.target.value as RecipientValue)} className={selectCls}>
            <option value="">— select —</option>
            <optgroup label="Irrevocable trusts">
              {trusts.map((t) => <option key={t.id} value={`entity:${t.id}`}>{t.name} (irrevocable trust)</option>)}
            </optgroup>
            {!requireTrust && (
              <>
                <optgroup label="Family">
                  {props.members.map((m) => (
                    <option key={m.id} value={`family:${m.id}`}>{m.firstName} {m.lastName ?? ""} ({m.role})</option>
                  ))}
                </optgroup>
                <optgroup label="External">
                  {props.externals.map((x) => (
                    <option key={x.id} value={`external:${x.id}`}>{x.name} ({x.kind})</option>
                  ))}
                </optgroup>
              </>
            )}
          </select>
        </Field>

        {/* Crummey (trust recipients only) */}
        {recipientIsTrust && (
          <label className="flex items-center gap-2 text-sm text-ink-2">
            <input type="checkbox" checked={crummey} onChange={(e) => setCrummey(e.target.checked)} />
            Use Crummey powers (annual-exclusion gift)
          </label>
        )}

        {error && <p data-testid="gift-error" className="text-sm text-crit">{error}</p>}
      </div>
    </DialogShell>
  );
}

const selectCls = "block w-full max-w-xs rounded border border-ink-3 bg-card px-2 py-1.5 text-sm text-ink";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs text-ink-3">{label}</label>
      {children}
    </div>
  );
}

function NumberInput({ value, onChange, className }: { value: number; onChange: (n: number) => void; className?: string }) {
  return (
    <input
      type="number"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className={`${className ?? ""} block w-full max-w-[10rem] rounded border border-ink-3 bg-card px-2 py-1.5 text-sm text-ink`}
    />
  );
}

function Segmented({ value, options, onChange }: { value: string; options: [string, string][]; onChange: (v: string) => void }) {
  return (
    <div className="inline-flex rounded border border-ink-3 p-0.5">
      {options.map(([val, label]) => (
        <button
          key={val}
          type="button"
          onClick={() => onChange(val)}
          className={`rounded px-3 py-1 text-xs ${value === val ? "bg-accent text-accent-on" : "text-ink-2"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
