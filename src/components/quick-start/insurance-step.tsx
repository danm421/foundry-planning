// src/components/quick-start/insurance-step.tsx
"use client";
import { CurrencyInput } from "@/components/currency-input";
import { inputClassName, selectClassName } from "@/components/forms/input-styles";
import { saveInsuranceRows, isEmptyInsurance, type InsuranceRow } from "@/lib/quick-start/insurance-save";
import type { QsPolicyType } from "@/lib/quick-start/types";
import type { QsInsuranceStepProps } from "./step-props";
import { CollapsibleListEditor, type ListColumn } from "./collapsible-list-editor";
import { Labeled, sendJson, fmtMoney } from "./ui";

const POLICY_LABEL: Record<QsPolicyType, string> = {
  term: "Term",
  whole: "Whole",
  universal: "Universal",
};

const COLUMNS: ListColumn[] = [
  { key: "insured", label: "Insured" },
  { key: "policy", label: "Policy" },
  { key: "face", label: "Face value", align: "right" },
  { key: "premium", label: "Premium", align: "right" },
];

export function InsuranceStep({ ctx, bootstrap, registerSave, list }: QsInsuranceStepProps) {
  const { rows, setRows, deletedServerIds, pushDeleted, clearDeleted, makeId } = list;

  const update = (id: number, patch: Partial<InsuranceRow>) =>
    setRows((rs) => rs.map((r) => (r._id === id ? { ...r, ...patch } : r)));

  const insuredLabel = (r: InsuranceRow) =>
    r.insured === "spouse" ? (ctx.spouseFirstName ?? "Spouse") : ctx.clientFirstName;

  registerSave(async () => {
    for (const r of rows) {
      if (isEmptyInsurance(r)) continue;
      if (r.policyType === "term" && !r.endsAtInsuredRetirement && !r.termLengthYears) {
        throw new Error("Term policies need a term length or 'ends at retirement'.");
      }
    }
    const result = await saveInsuranceRows(rows, deletedServerIds, {
      ctx,
      familyMemberIdFor: (insured) =>
        insured === "spouse" ? bootstrap.familyMemberIds.spouse : bootstrap.familyMemberIds.client,
      post: (body) =>
        sendJson(
          `/api/clients/${bootstrap.clientId}/insurance-policies`,
          "POST",
          body,
        ) as Promise<{ id: string }>,
      patch: (policyId, body) =>
        sendJson(
          `/api/clients/${bootstrap.clientId}/insurance-policies/${policyId}`,
          "PATCH",
          body,
        ),
      del: (policyId) =>
        sendJson(
          `/api/clients/${bootstrap.clientId}/insurance-policies/${policyId}`,
          "DELETE",
          undefined,
        ),
    });
    setRows(result.rows);
    clearDeleted();
  });

  return (
    <div className="space-y-4">
      <CollapsibleListEditor<InsuranceRow>
        rows={rows}
        columns={COLUMNS}
        isEmpty={isEmptyInsurance}
        update={update}
        onChange={setRows}
        onRemove={(r) => {
          pushDeleted(r.serverId);
          setRows((rs) => rs.filter((x) => x._id !== r._id));
        }}
        newRow={() => ({
          _id: makeId(),
          insured: "client",
          policyType: "term",
          faceValue: 0,
          premiumAmount: 0,
        })}
        rowLabel={(r) => `${POLICY_LABEL[r.policyType]} · ${insuredLabel(r)}`}
        addLabel="+ Add policy"
        renderSummary={(r) => [
          <span key="i">{insuredLabel(r)}</span>,
          <span key="p">{POLICY_LABEL[r.policyType]}</span>,
          <span key="f">{fmtMoney(r.faceValue)}</span>,
          <span key="pr">{fmtMoney(r.premiumAmount)}</span>,
        ]}
        renderEditor={(r, upd) => (
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <Labeled label="Insured">
                <div role="group" aria-label="Insured" className="flex flex-wrap gap-1.5">
                  {(
                    ["client", ...(ctx.hasSpouse ? ["spouse"] : [])] as Array<"client" | "spouse">
                  ).map((v) => {
                    const label =
                      v === "client" ? ctx.clientFirstName : (ctx.spouseFirstName ?? "Spouse");
                    return (
                      <button
                        key={v}
                        type="button"
                        aria-pressed={r.insured === v}
                        onClick={() => upd({ insured: v })}
                        className={
                          "rounded-[var(--radius-sm)] border px-3 py-1.5 text-[12px] font-medium transition-colors " +
                          (r.insured === v
                            ? "border-accent bg-accent text-accent-on"
                            : "border-hair bg-card-2 text-ink-3 hover:text-ink")
                        }
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </Labeled>
            </div>

            <Labeled label="Policy type">
              <select
                aria-label="Policy type"
                value={r.policyType}
                onChange={(e) => upd({ policyType: e.target.value as QsPolicyType })}
                className={selectClassName}
              >
                <option value="term">Term</option>
                <option value="whole">Whole</option>
                <option value="universal">Universal</option>
              </select>
            </Labeled>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Labeled label="Face value">
                <CurrencyInput
                  aria-label="Face value"
                  value={r.faceValue || ""}
                  onChange={(raw) => upd({ faceValue: raw ? Number(raw) : 0 })}
                />
              </Labeled>
              <Labeled label="Annual premium">
                <CurrencyInput
                  aria-label="Annual premium"
                  value={r.premiumAmount || ""}
                  onChange={(raw) => upd({ premiumAmount: raw ? Number(raw) : 0 })}
                />
              </Labeled>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Labeled label="Premium years">
                <input
                  type="number"
                  aria-label="Premium years"
                  min={1}
                  value={r.premiumYears ?? ""}
                  onChange={(e) =>
                    upd({ premiumYears: e.target.value ? Number(e.target.value) : undefined })
                  }
                  className={inputClassName}
                />
              </Labeled>
              <Labeled label="Ends at retirement">
                <div className="flex h-9 items-center">
                  <input
                    type="checkbox"
                    aria-label="Ends at retirement"
                    checked={r.endsAtInsuredRetirement ?? false}
                    onChange={(e) => upd({ endsAtInsuredRetirement: e.target.checked })}
                    className="h-4 w-4 rounded border-hair accent-accent"
                  />
                </div>
              </Labeled>
            </div>

            {r.policyType === "term" && (
              <Labeled label="Term length (years)">
                <input
                  type="number"
                  aria-label="Term length"
                  min={1}
                  value={r.termLengthYears ?? ""}
                  onChange={(e) =>
                    upd({
                      termLengthYears: e.target.value ? Number(e.target.value) : undefined,
                    })
                  }
                  className={inputClassName}
                />
              </Labeled>
            )}
          </div>
        )}
      />
    </div>
  );
}
