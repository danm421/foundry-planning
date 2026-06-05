// src/components/quick-start/accounts-step.tsx
"use client";
import { CurrencyInput } from "@/components/currency-input";
import { selectClassName } from "@/components/forms/input-styles";
import { accountPayload, ACCOUNT_LABEL, RETIREMENT_LABEL } from "@/lib/quick-start/derive";
import { saveAccountRows, isEmptyAccount, type AccountRow } from "@/lib/quick-start/account-save";
import type { QsAccountKind, QsRetirementSubtype } from "@/lib/quick-start/types";
import type { QsAccountsStepProps } from "./step-props";
import { CollapsibleListEditor, type ListColumn } from "./collapsible-list-editor";
import { Labeled, OwnerPills, sendJson, fmtMoney } from "./ui";

const KIND_OPTIONS: { value: QsAccountKind; label: string }[] = [
  { value: "cash", label: "Cash" },
  { value: "taxable", label: "Taxable" },
  { value: "retirement", label: "Retirement" },
  { value: "real_estate", label: "Real estate" },
];

const SUBTYPE_OPTIONS: { value: QsRetirementSubtype; label: string }[] = [
  { value: "traditional_ira", label: "Traditional IRA" },
  { value: "roth_ira", label: "Roth IRA" },
  { value: "401k", label: "401(k)" },
  { value: "403b", label: "403(b)" },
];

const COLUMNS: ListColumn[] = [
  { key: "type", label: "Type" },
  { key: "owner", label: "Owner" },
  { key: "value", label: "Value", align: "right" },
  { key: "detail", label: "Detail" },
];

export function AccountsStep({
  ctx,
  bootstrap,
  registerSave,
  setCreatedAccounts,
  list,
}: QsAccountsStepProps) {
  const { rows, setRows, deletedServerIds, pushDeleted, clearDeleted, makeId } = list;

  const update = (id: number, patch: Partial<AccountRow>) =>
    setRows((rs) => rs.map((r) => (r._id === id ? { ...r, ...patch } : r)));

  const ownerLabel = (r: AccountRow) =>
    r.owner === "spouse"
      ? ctx.spouseFirstName ?? "Spouse"
      : r.owner === "joint"
        ? "Joint"
        : ctx.clientFirstName;

  registerSave(async () => {
    const result = await saveAccountRows(rows, deletedServerIds, {
      ctx,
      post: (body) =>
        sendJson(
          `/api/clients/${bootstrap.clientId}/accounts`,
          "POST",
          body,
        ) as Promise<{ id: string }>,
      put: (accountId, body) =>
        sendJson(`/api/clients/${bootstrap.clientId}/accounts/${accountId}`, "PUT", body),
      del: (accountId) =>
        sendJson(
          `/api/clients/${bootstrap.clientId}/accounts/${accountId}`,
          "DELETE",
          undefined,
        ),
    });
    setRows(result.rows);
    clearDeleted();
    setCreatedAccounts(
      result.rows
        .filter((r) => r.serverId)
        .map((r) => {
          const { _id, serverId, ...draft } = r;
          void _id;
          const p = accountPayload(draft, ctx);
          return { id: serverId!, category: p.category, subType: p.subType, name: p.name };
        }),
    );
  });

  return (
    <div className="space-y-4">
      <CollapsibleListEditor<AccountRow>
        rows={rows}
        columns={COLUMNS}
        isEmpty={isEmptyAccount}
        update={update}
        onChange={setRows}
        onRemove={(r) => {
          pushDeleted(r.serverId);
          setRows((rs) => rs.filter((x) => x._id !== r._id));
        }}
        newRow={() => ({ _id: makeId(), kind: "cash", owner: "client", value: 0 })}
        rowLabel={(r) => `${ACCOUNT_LABEL[r.kind]} · ${ownerLabel(r)}`}
        addLabel="+ Add account"
        renderSummary={(r) => [
          <span key="t">{ACCOUNT_LABEL[r.kind]}</span>,
          <span key="o">{ownerLabel(r)}</span>,
          <span key="v">{fmtMoney(r.value)}</span>,
          <span key="d">
            {r.kind === "retirement" && r.subType ? RETIREMENT_LABEL[r.subType] : "—"}
          </span>,
        ]}
        renderEditor={(r, upd) => (
          <div className="space-y-3">
            <div className="flex flex-wrap items-start gap-3">
              <Labeled label="Type">
                <select
                  aria-label="Type"
                  value={r.kind}
                  onChange={(e) =>
                    upd({ kind: e.target.value as QsAccountKind, subType: undefined })
                  }
                  className={selectClassName}
                >
                  {KIND_OPTIONS.map((k) => (
                    <option key={k.value} value={k.value}>
                      {k.label}
                    </option>
                  ))}
                </select>
              </Labeled>
              <Labeled label="Owner">
                <OwnerPills
                  value={r.owner}
                  onChange={(o) => upd({ owner: o })}
                  clientName={ctx.clientFirstName}
                  spouseName={ctx.hasSpouse ? ctx.spouseFirstName : null}
                />
              </Labeled>
            </div>
            {r.kind === "retirement" && (
              <Labeled label="Account type">
                <select
                  aria-label="Account type"
                  value={r.subType ?? "traditional_ira"}
                  onChange={(e) =>
                    upd({ subType: e.target.value as QsRetirementSubtype })
                  }
                  className={selectClassName}
                >
                  {SUBTYPE_OPTIONS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </Labeled>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Labeled label="Value">
                <CurrencyInput
                  aria-label="Value"
                  value={r.value || ""}
                  onChange={(raw) => upd({ value: raw ? Number(raw) : 0 })}
                />
              </Labeled>
              {(r.kind === "taxable" || r.kind === "real_estate") && (
                <Labeled label="Cost basis">
                  <CurrencyInput
                    aria-label="Cost basis"
                    value={r.basis ?? ""}
                    onChange={(raw) => upd({ basis: raw ? Number(raw) : undefined })}
                  />
                </Labeled>
              )}
            </div>
          </div>
        )}
      />
    </div>
  );
}
