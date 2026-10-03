"use client";

import { useState, type ReactNode } from "react";
import type { ClientInfo, StressTest, StressTestKind, StressTestParams } from "@/engine/types";
import type { ChangesPanelChange } from "@/components/scenario/changes-panel";
import type { SolverMutation, SolverMutationKey } from "@/lib/solver/types";
import { useClientAccess } from "@/components/client-access-provider";
import { FieldTooltip } from "@/components/forms/field-tooltip";
import { STRESS_TEST_IDS } from "@/engine/stress-tests";
import { STRESS_TEST_LABELS, stressTestName } from "@/lib/stress-tests/describe";
import { STRESS_MUTATION_KIND, stressMutationFromParams } from "@/lib/solver/stress-test-mutations";
import { StressRow } from "./solver-stress-fields";
import { removeStressTest, saveStressTest, setStressTestEnabled } from "./solver-stress-saved";

type ParamsOf<K extends StressTestKind> = Extract<StressTestParams, { kind: K }>;

/** What every stress row needs from the tab, bundled so six call sites pass one prop. */
export interface StressScenarioContext {
  clientId: string;
  /** null on the base case: a saved stress test lives in a scenario. */
  scenarioId: string | null;
  scenarioName: string | null;
  /** Names the disability stressor's person in the saved change's title. */
  client: ClientInfo;
  /** Switched-off toggle groups by id (see `switchedOffGroupNames`). */
  offGroupNames: Record<string, string>;
  onChange(m: SolverMutation): void;
  onResetField(keys: SolverMutationKey[]): void;
  /** Reloads page data so the change list and the scenario's tree catch up. */
  onSaved(): void;
}

const STRESS_BASE_CASE_HINT = "Pick or create a scenario first. A saved stress test lives in a scenario.";
const ADD_STRESS_AS_CHANGE_TOOLTIP = (scenario: string) =>
  `Saves this stress test into ${scenario} as its own change. Switch it on and off here or on the Changes tab; presentations built from ${scenario} show it while it is on.`;

/** True when a commit would store what is already saved. The fields commit on
 *  every blur, so tabbing through a saved row must not re-save it. */
function unchanged(next: StressTestParams, saved: StressTestParams): boolean {
  const n = next as Record<string, unknown>;
  const s = saved as Record<string, unknown>;
  return Object.keys(n).every((k) => n[k] === s[k]);
}

/**
 * One Stress-tab stressor. Unsaved, the checkbox and fields drive a Solver
 * draft, as they always have. Saved in the scenario (spec 2026-10-03), the
 * same controls act on the saved change: the checkbox is its on/off switch,
 * each field commit re-saves it, and Remove deletes it. Saved-ness comes from
 * the scenario's change list, never the tree — a switched-off stressor is not
 * in the tree at all.
 */
export function StressTestRow<K extends StressTestKind>(props: {
  kind: K;
  hint: string;
  disabled?: boolean;
  /** The draft's value in the working tree; null when the stressor is off there. */
  draft: ParamsOf<K> | null;
  /** What ticking the box starts from. */
  defaults: ParamsOf<K>;
  /** This kind's saved change in the scenario, on or off; null when unsaved. */
  saved: ChangesPanelChange | null;
  ctx: StressScenarioContext;
  children(params: ParamsOf<K>, commit: (next: ParamsOf<K>) => void): ReactNode;
}) {
  const { ctx } = props;
  const canEdit = useClientAccess().permission === "edit";
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  // What this row last saved, held until the refreshed change list (a new
  // `updatedAt`) delivers it. A second field edit in that window builds on the
  // first, not on the stale `saved` prop, which would quietly undo it.
  const [sent, setSent] = useState<{ stamp: string; params: StressTestParams } | null>(null);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setFailed(false);
    try {
      await action();
      ctx.onSaved();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  const entity = (p: ParamsOf<K>): StressTest =>
    ({ ...p, id: STRESS_TEST_IDS[p.kind], name: stressTestName(p, ctx.client) }) as StressTest;
  const scenarioLabel = ctx.scenarioName ?? "this scenario";
  const failure = failed && (
    <span role="alert" className="text-[11px] text-crit">
      Couldn&apos;t save. Try again.
    </span>
  );

  if (props.saved && ctx.scenarioId) {
    const scenarioId = ctx.scenarioId;
    const { id: changeId, enabled } = props.saved;
    const stamp = String(props.saved.updatedAt);
    const savedParams = (sent?.stamp === stamp ? sent.params : props.saved.payload) as ParamsOf<K>;
    const locked = !canEdit || busy;
    // A switched-off group keeps the change out of the tree whatever its own
    // switch says, so the row reads off and its switch can't help.
    const offGroup = props.saved.toggleGroupId ? ctx.offGroupNames[props.saved.toggleGroupId] : undefined;
    const applied = enabled && !offGroup;
    return (
      <StressRow
        label={STRESS_TEST_LABELS[props.kind]}
        hint={props.hint}
        on={applied}
        disabled={props.disabled}
        lockToggle={locked || Boolean(offGroup)}
        onToggle={(checked) => void run(() => setStressTestEnabled(ctx.clientId, scenarioId, changeId, checked))}
        footer={
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[11px] text-ink-3">
              {offGroup
                ? `Saved in ${scenarioLabel}, but its group “${offGroup}” is switched off on the Changes tab.`
                : enabled
                  ? `Saved in ${scenarioLabel}.`
                  : `Saved in ${scenarioLabel}, switched off.`}
            </span>
            <button
              type="button"
              disabled={locked}
              onClick={() => void run(() => removeStressTest(ctx.clientId, scenarioId, STRESS_TEST_IDS[props.kind]))}
              className="text-[11px] font-medium text-accent hover:text-accent-ink hover:underline disabled:opacity-50"
            >
              Remove from scenario
            </button>
            {!applied && props.draft !== null && (
              // A scenario saved before stress tests were their own changes can
              // carry this stressor inside one combined plan-assumption change,
              // which this switch does not reach.
              <span className="w-full text-[11px] text-warn">
                Still applied by an older combined change on the Changes tab.
              </span>
            )}
            {failure}
          </div>
        }
      >
        <fieldset disabled={locked} className="m-0 min-w-0 border-0 p-0">
          {props.children(savedParams, (next) => {
            if (unchanged(next, savedParams)) return;
            void run(async () => {
              await saveStressTest(ctx.clientId, scenarioId, entity(next));
              setSent({ stamp, params: next });
            });
          })}
        </fieldset>
      </StressRow>
    );
  }

  const draft = props.draft;
  const scenarioId = ctx.scenarioId;
  return (
    <StressRow
      label={STRESS_TEST_LABELS[props.kind]}
      hint={props.hint}
      on={draft !== null}
      disabled={props.disabled}
      onToggle={(checked) =>
        checked
          ? ctx.onChange(stressMutationFromParams(props.defaults))
          : ctx.onResetField([STRESS_MUTATION_KIND[props.kind]])
      }
      footer={
        draft !== null && !props.disabled ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              // A second click before the refresh lands is harmless: the fixed
              // id makes it an upsert of the same row.
              disabled={scenarioId === null || !canEdit || busy}
              onClick={() => {
                if (scenarioId) void run(() => saveStressTest(ctx.clientId, scenarioId, entity(draft)));
              }}
              className="rounded border border-hair px-2.5 py-1 text-[12px] font-medium text-ink hover:border-accent disabled:opacity-50"
            >
              Add as change
            </button>
            {scenarioId === null ? (
              // Said inline, not in a tooltip: a disabled button can't be hovered for help.
              <span className="text-[11px] text-ink-3">{STRESS_BASE_CASE_HINT}</span>
            ) : (
              <FieldTooltip text={ADD_STRESS_AS_CHANGE_TOOLTIP(scenarioLabel)} />
            )}
            {failure}
          </div>
        ) : null
      }
    >
      {draft !== null && props.children(draft, (next) => ctx.onChange(stressMutationFromParams(next)))}
    </StressRow>
  );
}
