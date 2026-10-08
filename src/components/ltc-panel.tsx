// src/components/ltc-panel.tsx
"use client";

/**
 * Long-term care policies on the Insurance details page.
 *
 * Every write goes through the dialog — no inline cells — so there is one save
 * path and one shape. Inside a scenario each write is an `ltc_policy` change
 * through `useScenarioWriter`; in base mode it hits `/ltc-policies`.
 *
 * Focus mode serves the Solver's Changes tab exactly like `disability-panel.tsx`:
 * the focused row's dialog alone, control handed back through `onFocusClose`.
 */

import { useState } from "react";
import { useClientAccess } from "@/components/client-access-provider";
import { useScenarioWriter } from "@/hooks/use-scenario-writer";
import { useFocusCloseOnce, type FocusCloseOutcome } from "@/hooks/use-focus-close-once";
import { useFocusDelete } from "@/hooks/use-focus-delete";
import { focusRowId, isEditFocus, type EditorFocus } from "@/lib/scenario/change-editor-target";
import LtcPolicyDialog, { type LtcLifePolicyOption } from "@/components/ltc-policy-dialog";
import type { LtcPolicy } from "@/engine/types";
import {
  ltcBenefitText,
  ltcInflationText,
  ltcPremiumText,
  ltcTypeText,
} from "@/lib/insurance-policies/ltc-labels";
import { personLabel } from "@/lib/owner-labels";

export interface LtcPanelProps {
  clientId: string;
  policies: LtcPolicy[];
  /** The scenario's life policies, for the rider picker and the rider rows. */
  lifePolicies: LtcLifePolicyOption[];
  clientFirstName: string;
  spouseFirstName: string | null;
  /** A co-client policy with no date of birth bills no premium; the row says so. */
  spouseDob: string | null;
  currentYear: number;
  /** Solver Changes tab: open one policy's editor alone. Read once at mount. */
  focus?: EditorFocus;
  /** Called once when focus mode ends; the host must then UNMOUNT the panel. */
  onFocusClose?: (outcome?: FocusCloseOutcome) => void;
}

type DialogState = { mode: "create" } | { mode: "edit"; policy: LtcPolicy };
type FocusTarget = DialogState | { mode: "delete"; policyId: string };

function findFocusTarget(focus: EditorFocus, policies: LtcPolicy[]): FocusTarget | null {
  if (focus.kind !== "ltc_policy") return null;
  if (focus.intent === "create") return { mode: "create" };
  const id = focusRowId(focus);
  const policy = policies.find((p) => p.id === id);
  if (!policy) return null;
  if (focus.intent === "delete") return { mode: "delete", policyId: policy.id };
  return isEditFocus(focus) ? { mode: "edit", policy } : null;
}

/** At most one warning per row, most blocking first. */
export function ltcRowWarning(
  p: LtcPolicy,
  lifePolicies: LtcLifePolicyOption[],
  spouseDob: string | null,
): string | null {
  if (p.kind === "life_rider" && !lifePolicies.some((o) => o.id === p.lifePolicyAccountId)) {
    return "Its life policy isn't in this scenario.";
  }
  if (
    p.kind === "standalone" &&
    p.insured === "spouse" &&
    !spouseDob &&
    p.annualPremium > 0 &&
    p.premiumPayMode !== "paid_up"
  ) {
    return "No date of birth on file, so this premium isn't in the cash flow.";
  }
  return null;
}

export default function LtcPanel(props: LtcPanelProps) {
  const { permission } = useClientAccess();
  const canEdit = permission === "edit";
  const writer = useScenarioWriter(props.clientId);
  const { focus, onFocusClose } = props;

  const [focusFound] = useState(() => (focus && canEdit ? findFocusTarget(focus, props.policies) : null));
  const focusDialog = focusFound && focusFound.mode !== "delete" ? focusFound : null;
  const [dialogState, setDialogState] = useState<DialogState | null>(focusDialog);

  const focusDeleting = useFocusDelete(
    focusFound?.mode === "delete"
      ? async () => {
          const policyId = focusFound.policyId;
          const res = await writer.submit(
            { op: "remove", targetKind: "ltc_policy", targetId: policyId },
            { url: `/api/clients/${props.clientId}/ltc-policies/${policyId}`, method: "DELETE" },
          );
          return res.ok;
        }
      : null,
    onFocusClose,
  );
  useFocusCloseOnce(focus, focusFound, dialogState !== null || focusDeleting, onFocusClose);

  const names = { clientName: props.clientFirstName, spouseName: props.spouseFirstName };
  const lifePolicy = (p: LtcPolicy) => props.lifePolicies.find((o) => o.id === p.lifePolicyAccountId) ?? null;

  const dialogElement = canEdit && dialogState !== null && (
    <LtcPolicyDialog
      {...dialogState}
      clientId={props.clientId}
      clientFirstName={props.clientFirstName}
      spouseFirstName={props.spouseFirstName}
      lifePolicies={props.lifePolicies}
      currentYear={props.currentYear}
      onClose={() => setDialogState(null)}
      // No refresh here: `writer.submit` refreshed when the save landed.
      onSaved={() => setDialogState(null)}
    />
  );

  if (focus) return <>{dialogElement}</>;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-ink">Long-term care</h2>
        {canEdit && (
          <button
            type="button"
            className="rounded-[var(--radius-sm)] bg-accent px-3 h-9 text-[13px] font-medium text-accent-on hover:bg-accent-ink"
            onClick={() => setDialogState({ mode: "create" })}
          >
            Add policy
          </button>
        )}
      </header>

      {props.policies.length === 0 ? (
        <div className="rounded-[var(--radius)] border border-hair bg-card p-6">
          <p className="text-[14px] font-medium text-ink">No long-term care coverage on file</p>
          <p className="mt-1 text-[13px] text-ink-2">
            A care need today would be paid from savings. Add a traditional policy, or a long-term care
            rider on a life policy.
          </p>
        </div>
      ) : (
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-ink-3">
              <th className="py-2 font-medium">Policy</th>
              <th className="font-medium">Insured</th>
              <th className="font-medium">Type</th>
              <th className="font-medium">Benefit</th>
              <th className="font-medium">Waiting period</th>
              <th className="font-medium">Inflation</th>
              <th className="text-right font-medium">Premium</th>
              <th>
                <span className="sr-only">Edit</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {props.policies.map((p) => {
              const life = lifePolicy(p);
              const warning = ltcRowWarning(p, props.lifePolicies, props.spouseDob);
              return (
                <tr key={p.id} className="border-t border-hair align-top">
                  <td className="py-2 text-ink">
                    <div className="flex flex-col gap-1">
                      <span>{p.name}</span>
                      {warning !== null && (
                        <span className="w-fit rounded-md border border-warn/40 bg-warn/10 px-2 py-0.5 text-[11px] text-warn">
                          {warning}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="py-2 text-ink-2">{personLabel(p.insured, names)}</td>
                  <td className="py-2 text-ink-2">{ltcTypeText(p, life?.name ?? null)}</td>
                  <td className="tabular py-2 text-ink">{ltcBenefitText(p, life?.faceValue ?? null)}</td>
                  <td className="tabular py-2 text-ink-2">{`${p.eliminationDays} days`}</td>
                  <td className="py-2 text-ink-2">{ltcInflationText(p)}</td>
                  <td className="tabular py-2 text-right text-ink">{ltcPremiumText(p)}</td>
                  <td className="py-2 text-right">
                    {canEdit && (
                      <button
                        type="button"
                        aria-label={`Edit ${p.name}`}
                        className="text-accent hover:underline"
                        onClick={() => setDialogState({ mode: "edit", policy: p })}
                      >
                        Edit
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {dialogElement}
    </div>
  );
}
