"use client";

import { useEffect, useState } from "react";

export type WillGrantor = "client" | "spouse";
export type WillAssetMode = "specific" | "all_assets";
export type WillCondition = "if_spouse_survives" | "if_spouse_predeceased" | "always";
export type WillRecipientKind =
  | "family_member"
  | "external_beneficiary"
  | "entity"
  | "spouse";

export interface WillsPanelRecipient {
  id?: string;
  recipientKind: WillRecipientKind;
  recipientId: string | null;
  percentage: number;
  sortOrder: number;
}

export interface WillsPanelBequest {
  id?: string;
  name: string;
  assetMode: WillAssetMode;
  accountId: string | null;
  percentage: number;
  condition: WillCondition;
  sortOrder: number;
  recipients: WillsPanelRecipient[];
}

export interface WillsPanelWill {
  id: string;
  grantor: WillGrantor;
  bequests: WillsPanelBequest[];
}

export interface WillsPanelPrimary {
  firstName: string;
  lastName: string;
  spouseName: string | null;
  spouseLastName: string | null;
}

export interface WillsPanelAccount {
  id: string;
  name: string;
  category: string;
}

export interface WillsPanelFamilyMember {
  id: string;
  firstName: string;
  lastName: string | null;
}

export interface WillsPanelExternal {
  id: string;
  name: string;
}

export interface WillsPanelEntity {
  id: string;
  name: string;
}

interface WillsPanelProps {
  clientId: string;
  primary: WillsPanelPrimary;
  accounts: WillsPanelAccount[];
  familyMembers: WillsPanelFamilyMember[];
  externalBeneficiaries: WillsPanelExternal[];
  entities: WillsPanelEntity[];
  initialWills: WillsPanelWill[];
}

const CONDITION_LABEL: Record<WillCondition, string> = {
  if_spouse_survives: "If spouse survives",
  if_spouse_predeceased: "If spouse predeceases",
  always: "Always",
};

function grantorFullName(grantor: WillGrantor, p: WillsPanelPrimary): string {
  if (grantor === "client") return `${p.firstName} ${p.lastName}`;
  return `${p.spouseName ?? ""} ${p.spouseLastName ?? p.lastName ?? ""}`.trim();
}

function recipientLabel(
  r: WillsPanelRecipient,
  fams: WillsPanelFamilyMember[],
  exts: WillsPanelExternal[],
  ents: WillsPanelEntity[],
  p: WillsPanelPrimary,
): string {
  if (r.recipientKind === "spouse") {
    return `${p.spouseName ?? "Spouse"} (spouse)`;
  }
  if (r.recipientKind === "family_member") {
    const f = fams.find((x) => x.id === r.recipientId);
    return f ? `${f.firstName} ${f.lastName ?? ""}`.trim() : "(family member)";
  }
  if (r.recipientKind === "external_beneficiary") {
    const e = exts.find((x) => x.id === r.recipientId);
    return e ? e.name : "(external beneficiary)";
  }
  const en = ents.find((x) => x.id === r.recipientId);
  return en ? en.name : "(entity)";
}

export default function WillsPanel(props: WillsPanelProps) {
  const { primary, initialWills, accounts, familyMembers, externalBeneficiaries, entities } = props;
  const [wills] = useState<WillsPanelWill[]>(initialWills);
  const [modalOpen, setModalOpen] = useState<WillGrantor | null>(null);

  // ESC-to-close while the modal is open.
  useEffect(() => {
    if (!modalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setModalOpen(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modalOpen]);

  const [draft, setDraft] = useState<WillsPanelBequest>({
    name: "",
    assetMode: "specific",
    accountId: null,
    percentage: 100,
    condition: "always",
    sortOrder: 0,
    recipients: [
      { recipientKind: "spouse", recipientId: null, percentage: 100, sortOrder: 0 },
    ],
  });

  return (
    <div className="space-y-8">
      {(["client", "spouse"] as const).map((g) => {
        if (g === "spouse" && !primary.spouseName) return null;
        const will = wills.find((w) => w.grantor === g);
        const heading = grantorFullName(g, primary) || (g === "client" ? "Client" : "Spouse");
        return (
          <section key={g} className="rounded-lg border border-gray-800 bg-gray-900/40 p-5">
            <header className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-100">
                {heading}&apos;s Will
              </h2>
              <button
                type="button"
                className="rounded-md border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-100 hover:bg-gray-700"
                onClick={() => {
                  const hasAccounts = accounts.length > 0;
                  setDraft({
                    name: "",
                    assetMode: hasAccounts ? "specific" : "all_assets",
                    accountId: hasAccounts ? accounts[0].id : null,
                    percentage: 100,
                    condition: "always",
                    sortOrder: (will?.bequests.length ?? 0),
                    recipients: [
                      { recipientKind: "spouse", recipientId: null, percentage: 100, sortOrder: 0 },
                    ],
                  });
                  setModalOpen(g);
                }}
              >
                + Add bequest
              </button>
            </header>
            {!will || will.bequests.length === 0 ? (
              <p className="text-sm text-gray-500">No bequests yet.</p>
            ) : (
              <ol className="space-y-2">
                {will.bequests.map((b, idx) => {
                  const assetLabel =
                    b.assetMode === "all_assets"
                      ? "All other assets"
                      : accounts.find((a) => a.id === b.accountId)?.name ??
                        "(unknown account)";
                  return (
                    <li
                      key={b.id ?? `${idx}`}
                      className="rounded-md border border-gray-800 bg-gray-900 p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium text-gray-100">{b.name}</p>
                          <p className="text-sm text-gray-400">
                            {b.percentage}% of {assetLabel}
                          </p>
                          <p className="mt-1 text-xs text-gray-500">
                            {CONDITION_LABEL[b.condition]}
                          </p>
                          <p className="mt-1 text-xs text-gray-400">
                            {b.recipients
                              .map(
                                (r) =>
                                  `${recipientLabel(r, familyMembers, externalBeneficiaries, entities, primary)} (${r.percentage}%)`,
                              )
                              .join(", ")}
                          </p>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        );
      })}

      {modalOpen && (() => {
        const recipientSum = draft.recipients.reduce((s, x) => s + x.percentage, 0);
        const recipientSumOk = Math.abs(recipientSum - 100) < 0.01;
        return (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="New bequest"
          onClick={() => setModalOpen(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg rounded-lg border border-gray-700 bg-gray-900 p-5"
          >
            <h3 className="mb-4 text-base font-semibold text-gray-100">New bequest</h3>

            <label className="mb-3 block text-sm">
              <span className="mb-1 block text-gray-300">Name</span>
              <input
                type="text"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                className="w-full rounded-md border border-gray-700 bg-gray-800 px-2 py-1.5 text-gray-100"
              />
            </label>

            <label className="mb-3 block text-sm">
              <span className="mb-1 block text-gray-300">Asset</span>
              <select
                value={draft.assetMode === "all_assets" ? "__residual__" : (draft.accountId ?? "")}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "__residual__") {
                    setDraft({ ...draft, assetMode: "all_assets", accountId: null });
                  } else {
                    setDraft({ ...draft, assetMode: "specific", accountId: v });
                  }
                }}
                className="w-full rounded-md border border-gray-700 bg-gray-800 px-2 py-1.5 text-gray-100"
              >
                <option value="__residual__">All other assets</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </label>

            <label className="mb-3 block text-sm">
              <span className="mb-1 block text-gray-300">Percentage</span>
              <input
                type="number"
                min={0.01}
                max={100}
                step={0.01}
                value={draft.percentage}
                onChange={(e) => setDraft({ ...draft, percentage: parseFloat(e.target.value) || 0 })}
                className="w-full rounded-md border border-gray-700 bg-gray-800 px-2 py-1.5 text-gray-100"
              />
            </label>

            <label className="mb-3 block text-sm">
              <span className="mb-1 block text-gray-300">Condition</span>
              <select
                value={draft.condition}
                onChange={(e) => setDraft({ ...draft, condition: e.target.value as WillCondition })}
                className="w-full rounded-md border border-gray-700 bg-gray-800 px-2 py-1.5 text-gray-100"
              >
                <option value="always">Always</option>
                <option value="if_spouse_survives">If spouse survives</option>
                <option value="if_spouse_predeceased">If spouse predeceases</option>
              </select>
            </label>

            <fieldset className="mb-4">
              <legend className="mb-2 text-sm text-gray-300">Recipients</legend>
              {draft.recipients.map((r, i) => (
                <div key={i} className="mb-2 flex items-center gap-2">
                  <select
                    value={r.recipientKind}
                    onChange={(e) => {
                      const nextKind = e.target.value as WillRecipientKind;
                      const next = [...draft.recipients];
                      next[i] = {
                        ...r,
                        recipientKind: nextKind,
                        recipientId: nextKind === "spouse" ? null : (
                          nextKind === "family_member" ? familyMembers[0]?.id ?? null :
                          nextKind === "external_beneficiary" ? externalBeneficiaries[0]?.id ?? null :
                          entities[0]?.id ?? null
                        ),
                      };
                      setDraft({ ...draft, recipients: next });
                    }}
                    className="rounded-md border border-gray-700 bg-gray-800 px-2 py-1 text-sm text-gray-100"
                  >
                    <option value="spouse">Spouse</option>
                    <option value="family_member">Family member</option>
                    <option value="external_beneficiary">External beneficiary</option>
                    <option value="entity">Entity / Trust</option>
                  </select>
                  {r.recipientKind !== "spouse" && (
                    <select
                      value={r.recipientId ?? ""}
                      onChange={(e) => {
                        const next = [...draft.recipients];
                        next[i] = { ...r, recipientId: e.target.value };
                        setDraft({ ...draft, recipients: next });
                      }}
                      className="flex-1 rounded-md border border-gray-700 bg-gray-800 px-2 py-1 text-sm text-gray-100"
                    >
                      {r.recipientKind === "family_member" &&
                        familyMembers.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.firstName} {f.lastName ?? ""}
                          </option>
                        ))}
                      {r.recipientKind === "external_beneficiary" &&
                        externalBeneficiaries.map((x) => (
                          <option key={x.id} value={x.id}>{x.name}</option>
                        ))}
                      {r.recipientKind === "entity" &&
                        entities.map((x) => (
                          <option key={x.id} value={x.id}>{x.name}</option>
                        ))}
                    </select>
                  )}
                  <input
                    type="number"
                    min={0.01}
                    max={100}
                    step={0.01}
                    value={r.percentage}
                    onChange={(e) => {
                      const next = [...draft.recipients];
                      next[i] = { ...r, percentage: parseFloat(e.target.value) || 0 };
                      setDraft({ ...draft, recipients: next });
                    }}
                    className="w-20 rounded-md border border-gray-700 bg-gray-800 px-2 py-1 text-sm text-gray-100"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const next = draft.recipients.filter((_, j) => j !== i);
                      setDraft({ ...draft, recipients: next });
                    }}
                    className="rounded-md border border-gray-700 px-2 py-1 text-sm text-gray-300 hover:bg-gray-800"
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => {
                  const sortOrder = draft.recipients.length;
                  setDraft({
                    ...draft,
                    recipients: [
                      ...draft.recipients,
                      {
                        recipientKind: "family_member",
                        recipientId: familyMembers[0]?.id ?? null,
                        percentage: 0,
                        sortOrder,
                      },
                    ],
                  });
                }}
                className="rounded-md border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-gray-100 hover:bg-gray-700"
              >
                + Add recipient
              </button>
              <p className="mt-2 text-xs text-gray-400">
                Total:{" "}
                <span className={recipientSumOk ? "text-green-400" : "text-red-400"}>
                  {recipientSum.toFixed(2)}%
                </span>
              </p>
            </fieldset>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setModalOpen(null)}
                className="rounded-md border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-100 hover:bg-gray-700"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!draft.name.trim() || !recipientSumOk}
                onClick={() => {
                  // Save wiring is Task 10's responsibility. For now just close the modal.
                  setModalOpen(null);
                }}
                className="rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Save
              </button>
            </div>
          </div>
        </div>
        );
      })()}
    </div>
  );
}
