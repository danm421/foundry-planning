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
        <p className="text-sm text-gray-400">
          No beneficiary designations yet. Open an account or trust to add them.
        </p>
      </section>
    );
  }

  return (
    <section>
      <header className="mb-3">
        <h2 className="text-xl font-bold text-gray-100">Beneficiary Designations</h2>
      </header>

      {accountRows.length > 0 && (
        <div className="mb-4">
          <h3 className="mb-2 text-xs uppercase tracking-wider text-gray-500">Accounts</h3>
          <div className="space-y-2">
            {accountRows.map(({ account, rows }) => {
              const isTOD = account.category === "cash" || account.category === "taxable";
              const primaryLine = formatTier("primary", rows, members, externals);
              const contingentLine = formatTier("contingent", rows, members, externals);
              return (
                <div
                  key={account.id}
                  className="rounded-lg border border-gray-800 bg-gray-900/50 p-3"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="text-sm text-gray-100">
                        <span className="font-medium">{account.name}</span>
                        <span className="ml-2 text-xs text-gray-500">{account.category}</span>
                        {isTOD && (
                          <span className="ml-2 inline-flex items-center rounded bg-blue-900/40 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-blue-300">
                            TOD
                          </span>
                        )}
                      </div>
                      <dl className="mt-1 text-xs text-gray-300">
                        {primaryLine && (
                          <div>
                            <dt className="inline text-gray-500">Primary:&nbsp;</dt>
                            <dd className="inline">{primaryLine}</dd>
                          </div>
                        )}
                        {contingentLine && (
                          <div>
                            <dt className="inline text-gray-500">Contingent:&nbsp;</dt>
                            <dd className="inline">{contingentLine}</dd>
                          </div>
                        )}
                      </dl>
                    </div>
                    <button
                      type="button"
                      onClick={() => onEditAccount(account.id)}
                      className="rounded-md border border-gray-700 px-2 py-1 text-xs text-gray-200 hover:bg-gray-800"
                    >
                      Edit →
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
          <h3 className="mb-2 text-xs uppercase tracking-wider text-gray-500">
            Trust Remainders
          </h3>
          <div className="space-y-2">
            {trustRows.map(({ entity, rows }) => {
              const primaryLine = formatTier("primary", rows, members, externals);
              const contingentLine = formatTier("contingent", rows, members, externals);
              return (
                <div
                  key={entity.id}
                  className="rounded-lg border border-gray-800 bg-gray-900/50 p-3"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="text-sm font-medium text-gray-100">{entity.name}</div>
                      <dl className="mt-1 text-xs text-gray-300">
                        {primaryLine && (
                          <div>
                            <dt className="inline text-gray-500">Primary:&nbsp;</dt>
                            <dd className="inline">{primaryLine}</dd>
                          </div>
                        )}
                        {contingentLine && (
                          <div>
                            <dt className="inline text-gray-500">Contingent:&nbsp;</dt>
                            <dd className="inline">{contingentLine}</dd>
                          </div>
                        )}
                      </dl>
                    </div>
                    <button
                      type="button"
                      onClick={() => onEditEntity(entity.id)}
                      className="rounded-md border border-gray-700 px-2 py-1 text-xs text-gray-200 hover:bg-gray-800"
                    >
                      Edit →
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
