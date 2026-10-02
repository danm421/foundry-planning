"use client";

import { useState } from "react";
import type {
  CareSetting,
  ClientData,
  LtcCarePerson,
  LtcEvent,
  LtcHomeSale,
  ProjectionYear,
} from "@/engine/types";
import { resolveLtcEvent, type LtcWarning } from "@/engine/ltc-event";
import {
  CARE_SETTING_LABELS,
  DEFAULT_SELLING_COST_PCT,
  defaultCarePerson,
  presetAnnualCost,
} from "@/lib/ltc/care-cost-presets";
import { ltcEventName, ltcPersonFirstName } from "@/lib/ltc/ltc-event-name";
import { homeSalePreview } from "@/lib/ltc/home-sale-preview";
import { exactCurrency } from "@/lib/presentations/format";
import { DollarField, PercentField, SelectField, YearField } from "./solver-stress-fields";

const SETTING_OPTIONS = (Object.keys(CARE_SETTING_LABELS) as CareSetting[]).map((value) => ({
  value,
  label: CARE_SETTING_LABELS[value],
}));
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const CHECKBOX = "h-4 w-4 accent-accent";

function warningText(w: LtcWarning, tree: ClientData): string | null {
  switch (w.kind) {
    case "start_before_plan":
      return `${ltcPersonFirstName(w.person, tree.client)}'s start age has already passed. Pick an age that falls in ${tree.planSettings.planStartYear} or later.`;
    case "missing_dob":
      return `Add ${ltcPersonFirstName(w.person, tree.client)}'s date of birth to model their care.`;
    case "home_missing":
      return "The home picked for the sale is no longer in this plan.";
    case "home_already_sold":
      return `This plan already sells that home in ${w.soldYear}, so it can't be sold again.`;
    case "multiple_events":
      return null; // the UI never writes a second event
  }
}

export function LtcEventFields({
  event,
  tree,
  projectionYears,
  onChange,
}: {
  event: LtcEvent;
  tree: ClientData;
  projectionYears: ProjectionYear[];
  onChange(next: LtcEvent): void;
}) {
  // Bumped on every sale-year commit so the uncontrolled box remounts even when
  // the clamp lands on the year already saved (its value-key would not change).
  const [saleYearCommits, setSaleYearCommits] = useState(0);
  const commit = (patch: Partial<Omit<LtcEvent, "id" | "name">>) => {
    const next = { ...event, ...patch };
    onChange({ ...next, name: ltcEventName(next, tree.client) });
  };
  const resolution = resolveLtcEvent({ ...tree, ltcEvents: [event] });
  // With nobody's care in the plan the engine applies nothing — no cut, no
  // sale. The cut and the sale say why, in the same words as the warnings.
  const notApplied =
    resolution && resolution.people.length === 0
      ? resolution.warnings
          .filter((w) => w.kind === "start_before_plan" || w.kind === "missing_dob")
          .map((w) => warningText(w, tree))
          .join(" ")
      : null;
  const who: ("client" | "spouse")[] = tree.client.spouseDob ? ["client", "spouse"] : ["client"];
  const homes = tree.accounts.filter((a) => a.category === "real_estate");

  const setPerson = (person: "client" | "spouse", next: LtcCarePerson | null) => {
    const others = event.people.filter((p) => p.person !== person);
    const people = next ? [...others, next] : others;
    people.sort((a, b) => (a.person === b.person ? 0 : a.person === "client" ? -1 : 1));
    commit({ people });
  };

  const setSale = (patch: Partial<LtcHomeSale>) =>
    event.homeSale && commit({ homeSale: { ...event.homeSale, ...patch } });

  const defaultSale = (): LtcHomeSale => ({
    accountId: (homes.find((a) => a.subType === "primary_residence") ?? homes[0]).id,
    saleYear:
      resolution && resolution.people.length > 0
        ? Math.min(...resolution.people.map((p) => p.startYear))
        : tree.planSettings.planStartYear,
    price: { mode: "projected" },
    sellingCostPct: DEFAULT_SELLING_COST_PCT,
  });

  const lastProjectedYear = projectionYears.at(-1)?.year ?? tree.planSettings.planEndYear;
  const preview = event.homeSale ? homeSalePreview(projectionYears, tree, event.homeSale) : null;
  const notAppliedNote = notApplied ? <p className="mt-1 text-[11px] text-ink-3">{notApplied}</p> : null;

  return (
    <div className="space-y-4">
      {who.map((person) => {
        const p = event.people.find((x) => x.person === person) ?? null;
        const first = ltcPersonFirstName(person, tree.client);
        const resolved = resolution?.people.find((x) => x.person === person) ?? null;
        // An event needs someone in care — the last box can't be unticked.
        const isOnlyPerson = p !== null && event.people.length === 1;
        return (
          <fieldset key={person} className="space-y-3">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                className={CHECKBOX}
                checked={p !== null}
                disabled={isOnlyPerson}
                onChange={(e) => setPerson(person, e.target.checked ? defaultCarePerson(person) : null)}
              />
              <span className="text-[12px] font-medium text-ink">{first} needs care</span>
            </label>
            {p && (
              <div className="grid grid-cols-2 gap-x-5 gap-y-3 pl-6">
                <SelectField
                  label="Care setting"
                  value={p.careSetting}
                  options={SETTING_OPTIONS}
                  onCommit={(v) => {
                    const careSetting = v as CareSetting;
                    setPerson(person, { ...p, careSetting, annualCost: presetAnnualCost(careSetting) ?? p.annualCost });
                  }}
                />
                {/* Uncontrolled inputs: key by value so a programmatic change (a preset, a clamp) remounts them. */}
                <DollarField
                  key={`cost-${p.annualCost}`}
                  label="Yearly cost (today's dollars)"
                  value={p.annualCost}
                  onCommit={(d) => setPerson(person, { ...p, annualCost: d })}
                />
                <YearField
                  key={`age-${p.startAge}`}
                  label="Starts at age"
                  value={p.startAge}
                  onCommit={(n) => setPerson(person, { ...p, startAge: clamp(n, 0, 120) })}
                />
                <YearField
                  key={`years-${p.years}`}
                  label="Years of care"
                  value={p.years}
                  onCommit={(n) => setPerson(person, { ...p, years: clamp(n, 1, 30) })}
                />
                <PercentField
                  key={`infl-${p.costInflation}`}
                  label="Care cost growth"
                  value={p.costInflation}
                  onCommit={(d) => setPerson(person, { ...p, costInflation: clamp(d, 0, 0.15) })}
                />
              </div>
            )}
            {resolved && (
              <p className="pl-6 text-[11px] text-ink-3">
                {resolved.years === 1
                  ? `Care ${resolved.startYear} (age ${resolved.startAge}).`
                  : `Care ${resolved.startYear}–${resolved.endYear} (ages ${resolved.startAge}–${resolved.startAge + resolved.years - 1}).`}{" "}
                Life expectancy set to {resolved.startAge + resolved.years - 1} ({resolved.endYear}).
              </p>
            )}
          </fieldset>
        );
      })}

      <fieldset className="space-y-2 border-t border-hair pt-3">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            className={CHECKBOX}
            checked={event.livingExpenseCutPct != null}
            onChange={(e) => commit({ livingExpenseCutPct: e.target.checked ? 1 : null })}
          />
          <span className="text-[12px] font-medium text-ink">Cut living expenses during care</span>
        </label>
        {event.livingExpenseCutPct != null && (
          <div className="pl-6">
            <PercentField
              key={`cut-${event.livingExpenseCutPct}`}
              label="Cut by"
              value={event.livingExpenseCutPct}
              onCommit={(d) => commit({ livingExpenseCutPct: clamp(d, 0, 1) })}
            />
            <p className="mt-1 text-[11px] text-ink-3">
              100% stops living expenses during care. Use less when a spouse is still at home.
            </p>
            {notAppliedNote}
          </div>
        )}
      </fieldset>

      {homes.length > 0 && (
        <fieldset className="space-y-2 border-t border-hair pt-3">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className={CHECKBOX}
              checked={event.homeSale != null}
              onChange={(e) => commit({ homeSale: e.target.checked ? defaultSale() : null })}
            />
            <span className="text-[12px] font-medium text-ink">Sell the home</span>
          </label>
          {event.homeSale && preview && (
            <div className="space-y-3 pl-6">
              <div className="grid grid-cols-2 gap-x-5 gap-y-3">
                <SelectField
                  label="Home"
                  value={event.homeSale.accountId}
                  options={homes.map((a) => ({ value: a.id, label: a.name }))}
                  onCommit={(accountId) => setSale({ accountId })}
                />
                <YearField
                  key={`sale-${event.homeSale.saleYear}-${saleYearCommits}`}
                  label="Sale year"
                  value={event.homeSale.saleYear}
                  onCommit={(saleYear) => {
                    // A year outside the projection has no figures and the sale never runs.
                    setSale({ saleYear: clamp(saleYear, tree.planSettings.planStartYear, lastProjectedYear) });
                    setSaleYearCommits((n) => n + 1);
                  }}
                />
              </div>
              <div role="radiogroup" aria-label="Price used for the sale" className="flex gap-4 text-[12px] text-ink">
                <label className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    name={`ltc-price-${event.id}`}
                    checked={event.homeSale.price.mode === "projected"}
                    onChange={() => setSale({ price: { mode: "projected" } })}
                  />
                  Projected value
                </label>
                <label className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    name={`ltc-price-${event.id}`}
                    checked={event.homeSale.price.mode === "custom"}
                    onChange={() =>
                      setSale({ price: { mode: "custom", amount: Math.max(1, Math.round(preview.projectedValue ?? 0)) } })
                    }
                  />
                  Custom amount
                </label>
              </div>
              <div className="grid grid-cols-2 gap-x-5 gap-y-3">
                {event.homeSale.price.mode === "custom" && (
                  <DollarField
                    key={`price-${event.homeSale.price.amount}`}
                    label="Sale price"
                    value={event.homeSale.price.amount}
                    onCommit={(d) => setSale({ price: { mode: "custom", amount: Math.max(1, d) } })}
                  />
                )}
                <PercentField
                  key={`sell-${event.homeSale.sellingCostPct}`}
                  label="Selling costs"
                  value={event.homeSale.sellingCostPct}
                  onCommit={(d) => setSale({ sellingCostPct: clamp(d, 0, 0.2) })}
                />
              </div>
              {notAppliedNote ?? (
                <dl className="space-y-1 rounded border border-hair p-3 text-[12px] text-ink">
                  <div className="flex justify-between gap-4">
                    <dt>Projected value in {event.homeSale.saleYear}</dt>
                    <dd className="tabular">
                      {preview.projectedValue == null ? "—" : exactCurrency(preview.projectedValue)}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt>Mortgage left</dt>
                    <dd className="tabular">{preview.mortgageLeft == null ? "—" : exactCurrency(preview.mortgageLeft)}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt>Selling costs</dt>
                    <dd className="tabular">{preview.sellingCosts == null ? "—" : exactCurrency(preview.sellingCosts)}</dd>
                  </div>
                  <div className="flex justify-between gap-4 font-medium">
                    <dt>Estimated cash to the household</dt>
                    <dd className="tabular">
                      {preview.cashToHousehold == null ? "—" : `${exactCurrency(preview.cashToHousehold)} before tax`}
                    </dd>
                  </div>
                </dl>
              )}
            </div>
          )}
        </fieldset>
      )}

      <LtcWarnings warnings={resolution?.warnings ?? []} tree={tree} />
    </div>
  );
}

/** The engine's warnings, one sentence each. Also shown by the Stress row for a
 *  saved event, so both say the same thing. */
export function LtcWarnings({ warnings, tree }: { warnings: LtcWarning[]; tree: ClientData }) {
  return warnings.map((w, i) => {
    const text = warningText(w, tree);
    return text ? (
      <p key={i} role="status" className="text-[11px] text-crit">
        {text}
      </p>
    ) : null;
  });
}
