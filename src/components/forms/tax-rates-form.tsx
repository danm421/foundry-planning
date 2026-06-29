"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PercentInput } from "@/components/percent-input";
import { CurrencyInput } from "@/components/currency-input";
import { HelpTip } from "@/components/help-tip";
import { STATE_ESTATE_TAX, type Bracket } from "@/lib/tax/state-estate";
import { USPS_STATE_NAMES, USPS_STATE_CODES, type USPSStateCode } from "@/lib/usps-states";
import { useClientAccess } from "@/components/client-access-provider";

interface TaxRatesFormProps {
  clientId: string;
  flatFederalRate: string;
  flatStateRate: string;
  estateAdminExpenses: string;
  flatStateEstateRate: string;
  residenceState: USPSStateCode | null;
  irdTaxRate: string;
  probateCostRate: string;
  lifetimeExemptionCap: string;
  outOfHouseholdDniRate: string;
  priorTaxableGiftsClient: string;
  priorTaxableGiftsSpouse: string;
  hasSpouse: boolean;
  clientFirstName?: string;
  spouseFirstName?: string;
  initialMode?: "flat" | "bracket";
}

const pct = (v: string) => (Number(v) * 100).toFixed(2);

function topRate(brackets: Bracket[]): number {
  return brackets.reduce((m, b) => Math.max(m, b.rate), 0);
}

const INHERITANCE_TAX_STATES = new Set(["PA", "NJ", "KY", "NE", "MD"]);

const STATE_OPTIONS = USPS_STATE_CODES
  .map((code) => {
    const name = USPS_STATE_NAMES[code];
    const estateRule = (STATE_ESTATE_TAX as Record<string, { exemption: number; brackets: Bracket[] } | undefined>)[code];
    const hasInheritance = INHERITANCE_TAX_STATES.has(code);
    let suffix: string;
    if (estateRule && hasInheritance) {
      suffix = `$${(estateRule.exemption / 1_000_000).toFixed(2)}M exemption · top ${Math.round(topRate(estateRule.brackets) * 100)}% · inheritance tax`;
    } else if (estateRule) {
      suffix = `$${(estateRule.exemption / 1_000_000).toFixed(2)}M exemption · top ${Math.round(topRate(estateRule.brackets) * 100)}%`;
    } else if (hasInheritance) {
      suffix = "inheritance tax only";
    } else {
      suffix = "no state estate or inheritance tax";
    }
    return { code, label: `${name} — ${suffix}` };
  })
  .sort((a, b) => a.label.localeCompare(b.label));

const INPUT_CLS =
  "block w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-1.5 text-sm text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent";

function SectionTitle({ title, help }: { title: string; help?: string }) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-300">{title}</h3>
      {help && <HelpTip text={help} />}
    </div>
  );
}

function FieldRow({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] items-center gap-4 px-3 py-2">
      <div className="flex items-center gap-1.5 text-xs font-medium text-gray-300">
        <span>{label}</span>
        {help && <HelpTip text={help} />}
      </div>
      <div>{children}</div>
    </div>
  );
}

function FieldTable({ children }: { children: React.ReactNode }) {
  return (
    <div className="divide-y divide-gray-800 rounded-md border border-gray-800 bg-gray-900/40">
      {children}
    </div>
  );
}

export default function TaxRatesForm({
  clientId,
  flatFederalRate,
  flatStateRate,
  estateAdminExpenses,
  flatStateEstateRate,
  residenceState,
  irdTaxRate,
  probateCostRate,
  lifetimeExemptionCap,
  outOfHouseholdDniRate,
  priorTaxableGiftsClient,
  priorTaxableGiftsSpouse,
  hasSpouse,
  clientFirstName,
  spouseFirstName,
  initialMode = "flat",
}: TaxRatesFormProps) {
  const { permission } = useClientAccess();
  const canEdit = permission === "edit";
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [mode, setMode] = useState<"flat" | "bracket">(initialMode);
  // Controlled across two `<select>`s (one in the Income Tax section, one in
  // the Estate Tax section) since residenceState drives both engines.
  const [residenceStateValue, setResidenceStateValue] = useState<USPSStateCode | "">(
    residenceState ?? "",
  );

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(false);

    const data = new FormData(e.currentTarget);
    const toDec = (name: string) => String(Number(data.get(name) as string) / 100);

    // residenceState is mirrored across two selects; read from controlled state
    // so the two stay in lockstep regardless of which one the user touched.
    const residence = residenceStateValue === "" ? null : residenceStateValue;
    const body: Record<string, string | null | undefined> = {
      flatStateRate: toDec("flatStateRate"),
      taxEngineMode: mode,
      estateAdminExpenses: String(Number(data.get("estateAdminExpenses") ?? "0")),
      flatStateEstateRate: String(Number(data.get("flatStateEstateRate") ?? "0") / 100),
      residenceState: residence,
      irdTaxRate: String(Number(data.get("irdTaxRate") ?? "0") / 100),
      probateCostRate: String(Number(data.get("probateCostRate") ?? "0") / 100),
      lifetimeExemptionCap: (() => {
        const raw = ((data.get("lifetimeExemptionCap") as string | null) ?? "").trim();
        if (raw === "") return null;
        const n = Number(raw);
        return Number.isFinite(n) && n > 0 ? String(n) : null;
      })(),
      outOfHouseholdDniRate: String(Number(data.get("outOfHouseholdDniRate") ?? "0") / 100),
      priorTaxableGiftsClient: String(Number(data.get("priorTaxableGiftsClient") ?? "0")),
      priorTaxableGiftsSpouse: hasSpouse
        ? String(Number(data.get("priorTaxableGiftsSpouse") ?? "0"))
        : "0",
    };

    if (mode === "flat") {
      body.flatFederalRate = toDec("flatFederalRate");
    }

    try {
      const res = await fetch(`/api/clients/${clientId}/plan-settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error ?? "Failed to save");
      }
      setSuccess(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && <p className="rounded bg-red-900/50 px-3 py-2 text-sm text-red-400">{error}</p>}
      {success && <p className="rounded bg-green-900/50 px-3 py-2 text-sm text-green-400">Saved.</p>}
      <fieldset disabled={!canEdit} className="space-y-6 border-0 p-0 m-0">
      <section>
        <SectionTitle
          title="Income Tax"
          help="Flat rates applied across the projection unless bracket mode is selected."
        />
        <FieldTable>
          <FieldRow
            label="Calculation method"
            help="Bracket mode uses progressive federal brackets, AMT, NIIT, and FICA based on filing status. Flat mode multiplies taxable income by your federal rate."
          >
            <div className="inline-flex rounded-md bg-gray-800 p-0.5">
              <button
                type="button"
                onClick={() => setMode("flat")}
                className={`px-2.5 py-1 text-xs rounded ${mode === "flat" ? "bg-gray-700 text-white" : "text-gray-300"}`}
              >
                Flat rate
              </button>
              <button
                type="button"
                onClick={() => setMode("bracket")}
                className={`px-2.5 py-1 text-xs rounded ${mode === "bracket" ? "bg-gray-700 text-white" : "text-gray-300"}`}
              >
                Bracket-based
              </button>
            </div>
          </FieldRow>
          {mode === "flat" && (
            <FieldRow label="Federal rate">
              <PercentInput
                id="flatFederalRate"
                name="flatFederalRate"
                defaultValue={pct(flatFederalRate)}
                className={`${INPUT_CLS} max-w-[10rem]`}
              />
            </FieldRow>
          )}
          <FieldRow label="State rate">
            <PercentInput
              id="flatStateRate"
              name="flatStateRate"
              defaultValue={pct(flatStateRate)}
              className={`${INPUT_CLS} max-w-[10rem]`}
            />
          </FieldRow>
          <FieldRow
            label="State of residence"
            help="If selected, the bracket-mode engine uses that state's brackets, deductions, and exemptions. Otherwise the flat state rate above applies. Also drives the state-of-residence used by the Estate Tax engine."
          >
            <select
              id="residenceStateIncome"
              value={residenceStateValue}
              onChange={(e) => setResidenceStateValue(e.target.value === "" ? "" : (e.target.value as USPSStateCode))}
              className={INPUT_CLS}
            >
              <option value="">— Use flat-rate fallback —</option>
              {USPS_STATE_CODES.map((code) => (
                <option key={code} value={code}>
                  {USPS_STATE_NAMES[code]}
                </option>
              ))}
            </select>
          </FieldRow>
        </FieldTable>
      </section>

      <section>
        <SectionTitle
          title="Estate Tax"
          help="Applied at each death event in the projection."
        />
        <FieldTable>
          <FieldRow label="Administrative expenses">
            <div className="max-w-[12rem]">
              <CurrencyInput
                id="estateAdminExpenses"
                name="estateAdminExpenses"
                defaultValue={estateAdminExpenses}
                className={INPUT_CLS}
              />
            </div>
          </FieldRow>
          <FieldRow
            label="State of residence"
            help="Selects the state estate / inheritance tax engine. Estate rules and inheritance tax flag are summarized in the option labels."
          >
            <select
              id="residenceState"
              name="residenceState"
              value={residenceStateValue}
              onChange={(e) => setResidenceStateValue(e.target.value === "" ? "" : (e.target.value as USPSStateCode))}
              className={INPUT_CLS}
            >
              <option value="">— Not set —</option>
              {STATE_OPTIONS.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.label}
                </option>
              ))}
            </select>
          </FieldRow>
          <FieldRow
            label="Override rate"
            help="Applied when no state is selected above. Leave blank to skip state estate tax entirely."
          >
            <PercentInput
              id="flatStateEstateRate"
              name="flatStateEstateRate"
              defaultValue={pct(flatStateEstateRate)}
              className={`${INPUT_CLS} max-w-[10rem]`}
            />
          </FieldRow>
          <FieldRow
            label="IRD tax rate"
            help="Applied to pre-tax retirement assets (Traditional IRA, 401(k), 403(b)) passing to a non-spouse, non-charity beneficiary at death."
          >
            <PercentInput
              id="irdTaxRate"
              name="irdTaxRate"
              defaultValue={pct(irdTaxRate)}
              className={`${INPUT_CLS} max-w-[10rem]`}
            />
          </FieldRow>
          <FieldRow
            label="Probate cost rate"
            help="Applied to the probate estate — assets passing through the will. Excludes jointly-titled property, beneficiary-designated accounts (life insurance, IRA/401(k), POD/TOD), and assets held in a trust."
          >
            <PercentInput
              id="probateCostRate"
              name="probateCostRate"
              defaultValue={pct(probateCostRate)}
              className={`${INPUT_CLS} max-w-[10rem]`}
            />
          </FieldRow>
          <FieldRow
            label="Lifetime exemption cap"
            help="Caps how high the federal estate/gift exemption grows. Leave blank to grow with inflation indefinitely. Enter a dollar amount to grow toward that ceiling and then freeze — or, if below today's exemption (~$15M), to freeze the exemption at that value for the whole plan."
          >
            <div className="max-w-[12rem]">
              <CurrencyInput
                id="lifetimeExemptionCap"
                name="lifetimeExemptionCap"
                defaultValue={lifetimeExemptionCap}
                placeholder="No cap"
                className={INPUT_CLS}
              />
            </div>
          </FieldRow>
        </FieldTable>
      </section>

      <section>
        <SectionTitle
          title="Trust Tax"
          help="Applied when a non-grantor trust distributes income to a beneficiary outside the household."
        />
        <FieldTable>
          <FieldRow
            label="Out-of-household DNI rate"
            help="Records an estimated recipient-side tax in the plan's tax summary. Defaults to top federal bracket (37%)."
          >
            <PercentInput
              id="outOfHouseholdDniRate"
              name="outOfHouseholdDniRate"
              defaultValue={pct(outOfHouseholdDniRate)}
              className={`${INPUT_CLS} max-w-[10rem]`}
            />
          </FieldRow>
        </FieldTable>
      </section>

      <section>
        <SectionTitle
          title="Prior lifetime gifts"
          help="Post-1976 cumulative taxable gifts before plan start. Pull from the most recent Form 709's 'prior periods' line. Joint pre-plan gifts are pre-attributed (a $200K joint gift = $100K on each spouse)."
        />
        <FieldTable>
          <FieldRow label={clientFirstName ?? "Client"}>
            <div className="max-w-[12rem]">
              <CurrencyInput
                id="priorTaxableGiftsClient"
                name="priorTaxableGiftsClient"
                defaultValue={priorTaxableGiftsClient}
                className={INPUT_CLS}
              />
            </div>
          </FieldRow>
          {hasSpouse && (
            <FieldRow label={spouseFirstName ?? "Spouse"}>
              <div className="max-w-[12rem]">
                <CurrencyInput
                  id="priorTaxableGiftsSpouse"
                  name="priorTaxableGiftsSpouse"
                  defaultValue={priorTaxableGiftsSpouse}
                  className={INPUT_CLS}
                />
              </div>
            </FieldRow>
          )}
        </FieldTable>
      </section>

      {canEdit && (
        <div className="flex justify-end pt-2">
          <button type="submit" disabled={loading} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-on hover:bg-accent-ink disabled:opacity-50">
            {loading ? "Saving…" : "Save"}
          </button>
        </div>
      )}
      </fieldset>
    </form>
  );
}
