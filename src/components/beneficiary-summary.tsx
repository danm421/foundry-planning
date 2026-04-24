"use client";

import type {
  AccountLite,
  Designation,
  Entity,
  ExternalBeneficiary,
  FamilyMember,
  Tier,
} from "./family-view";

interface BeneficiarySummaryProps {
  accounts: AccountLite[];
  entities: Entity[];
  designations: Designation[];
  members: FamilyMember[];
  externals: ExternalBeneficiary[];
  onEditAccount: (accountId: string) => void;
  onEditEntity: (entityId: string) => void;
}

function beneficiaryName(
  d: Designation,
  members: FamilyMember[],
  externals: ExternalBeneficiary[],
): string {
  if (d.familyMemberId) {
    const m = members.find((x) => x.id === d.familyMemberId);
    return m ? `${m.firstName}${m.lastName ? " " + m.lastName : ""}` : "(unknown member)";
  }
  if (d.externalBeneficiaryId) {
    const e = externals.find((x) => x.id === d.externalBeneficiaryId);
    return e ? e.name : "(unknown beneficiary)";
  }
  return "(unassigned)";
}

function formatTier(
  tier: Tier,
  rows: Designation[],
  members: FamilyMember[],
  externals: ExternalBeneficiary[],
): string {
  const parts = rows
    .filter((r) => r.tier === tier)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((r) => `${beneficiaryName(r, members, externals)} — ${r.percentage}%`);
  return parts.join(", ");
}

export default function BeneficiarySummary({
  accounts,
  entities,
  designations,
  members,
  externals,
  onEditAccount,
  onEditEntity,
}: BeneficiarySummaryProps) {
  const accountRows = accounts
    .map((a) => ({
      account: a,
      rows: designations.filter((d) => d.targetKind === "account" && d.accountId === a.id),
    }))
    .filter((x) => x.rows.length > 0);

  const trustRows = entities
    .filter((e) => e.entityType === "trust")
    .map((e) => ({
      entity: e,
      rows: designations.filter((d) => d.targetKind === "trust" && d.entityId === e.id),
    }))
    .filter((x) => x.rows.length > 0);

  if (accountRows.length === 0 && trustRows.length === 0) {
    return (
      <section>
        <header className="mb-3">
          <h2 className="text-xl font-bold text-gray-100">Beneficiary Designations</h2>
        </header>
        <div className="rounded-lg border border-dashed border-gray-800 bg-gray-900/40 p-6 text-center">
          <p className="text-sm text-gray-400">No beneficiary designations yet.</p>
          <p className="mt-1 text-xs text-gray-500">
            Open an account or trust above to add primary and contingent beneficiaries.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section>
      <header className="mb-4">
        <h2 className="text-xl font-bold text-gray-100">Beneficiary Designations</h2>
      </header>

      {accountRows.length > 0 && (
        <div className="mb-6">
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
            Accounts
          </h3>
          <div className="space-y-2">
            {accountRows.map(({ account, rows }) => {
              const isTOD = account.category === "cash" || account.category === "taxable";
              const primaryLine = formatTier("primary", rows, members, externals);
              const contingentLine = formatTier("contingent", rows, members, externals);
              return (
                <div
                  key={account.id}
                  className="group rounded-lg border border-gray-800 bg-gray-900/60 p-4 transition-colors hover:border-gray-700"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-sm font-semibold text-gray-100">
                          {account.name}
                        </span>
                        <span className="text-[11px] uppercase tracking-wide text-gray-500">
                          {account.category}
                        </span>
                        {isTOD && (
                          <span
                            className="inline-flex items-center rounded border border-blue-500/40 bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-blue-300"
                            title="Transfer on Death"
                          >
                            TOD
                          </span>
                        )}
                      </div>
                      <dl className="mt-2 space-y-1 text-xs text-gray-300">
                        {primaryLine && (
                          <div className="flex gap-2">
                            <dt className="w-20 shrink-0 text-gray-500">Primary:</dt>
                            <dd className="min-w-0 flex-1 text-gray-200">{primaryLine}</dd>
                          </div>
                        )}
                        {contingentLine && (
                          <div className="flex gap-2">
                            <dt className="w-20 shrink-0 text-gray-500">Contingent:</dt>
                            <dd className="min-w-0 flex-1 text-gray-200">{contingentLine}</dd>
                          </div>
                        )}
                      </dl>
                    </div>
                    <button
                      type="button"
                      onClick={() => onEditAccount(account.id)}
                      className="shrink-0 rounded-md border border-gray-700 px-2.5 py-1 text-xs font-medium text-gray-300 transition-colors hover:border-gray-600 hover:bg-gray-800 hover:text-gray-100"
                    >
                      Edit <span aria-hidden="true">→</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {trustRows.length > 0 && (
        <div>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
            Trust Remainders
          </h3>
          <div className="space-y-2">
            {trustRows.map(({ entity, rows }) => {
              const primaryLine = formatTier("primary", rows, members, externals);
              const contingentLine = formatTier("contingent", rows, members, externals);
              return (
                <div
                  key={entity.id}
                  className="group rounded-lg border border-gray-800 bg-gray-900/60 p-4 transition-colors hover:border-gray-700"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-gray-100">{entity.name}</div>
                      <dl className="mt-2 space-y-1 text-xs text-gray-300">
                        {primaryLine && (
                          <div className="flex gap-2">
                            <dt className="w-20 shrink-0 text-gray-500">Primary:</dt>
                            <dd className="min-w-0 flex-1 text-gray-200">{primaryLine}</dd>
                          </div>
                        )}
                        {contingentLine && (
                          <div className="flex gap-2">
                            <dt className="w-20 shrink-0 text-gray-500">Contingent:</dt>
                            <dd className="min-w-0 flex-1 text-gray-200">{contingentLine}</dd>
                          </div>
                        )}
                      </dl>
                    </div>
                    <button
                      type="button"
                      onClick={() => onEditEntity(entity.id)}
                      className="shrink-0 rounded-md border border-gray-700 px-2.5 py-1 text-xs font-medium text-gray-300 transition-colors hover:border-gray-600 hover:bg-gray-800 hover:text-gray-100"
                    >
                      Edit <span aria-hidden="true">→</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
