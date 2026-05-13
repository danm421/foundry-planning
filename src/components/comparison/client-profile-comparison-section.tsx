"use client";

import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";
import type { ClientData, FamilyMember } from "@/engine/types";
import { seriesColor } from "@/lib/comparison/series-palette";

function ageFromDob(dob: string | null | undefined, today = new Date()): number | null {
  if (!dob) return null;
  const y = Number(dob.slice(0, 4));
  if (!Number.isFinite(y)) return null;
  return today.getUTCFullYear() - y;
}

function retirementYearFromAge(
  dob: string | null | undefined,
  retirementAge: number | null | undefined,
): number | null {
  if (!dob) return null;
  const y = Number(dob.slice(0, 4));
  if (!Number.isFinite(y) || retirementAge == null) return null;
  return y + retirementAge;
}

function OwnerCard({
  name,
  dob,
  retirementAge,
  lifeExpectancy,
}: {
  name: string;
  dob: string | null;
  retirementAge: number | null;
  lifeExpectancy: number | null;
}) {
  const age = ageFromDob(dob);
  const retYear = retirementYearFromAge(dob, retirementAge);
  return (
    <div className="rounded border border-slate-700 bg-slate-950/30 p-3 text-sm">
      <div className="mb-2 font-semibold text-slate-100">{name}</div>
      <dl className="grid grid-cols-[1fr_auto] gap-y-1 text-xs">
        {age != null && (
          <>
            <dt className="text-slate-400">Age</dt>
            <dd className="text-right tabular-nums text-slate-200">{age}</dd>
          </>
        )}
        {dob && (
          <>
            <dt className="text-slate-400">Date of Birth</dt>
            <dd className="text-right tabular-nums text-slate-200">{dob}</dd>
          </>
        )}
        {retirementAge != null && (
          <>
            <dt className="text-slate-400">Retirement Age</dt>
            <dd className="text-right tabular-nums text-slate-200">{retirementAge}</dd>
          </>
        )}
        {retYear != null && (
          <>
            <dt className="text-slate-400">Retirement Year</dt>
            <dd className="text-right tabular-nums text-slate-200">{retYear}</dd>
          </>
        )}
        {lifeExpectancy != null && (
          <>
            <dt className="text-slate-400">Life Expectancy</dt>
            <dd className="text-right tabular-nums text-slate-200">{lifeExpectancy}</dd>
          </>
        )}
      </dl>
    </div>
  );
}

function familyMemberDisplayName(f: FamilyMember): string {
  return `${f.firstName} ${f.lastName ?? ""}`.trim();
}

function PlanColumn({ plan, index }: { plan: ComparisonPlan; index: number }) {
  const c: ClientData["client"] = plan.tree.client;
  const family: FamilyMember[] = (plan.tree.familyMembers ?? []).filter(
    (f) => f.role !== "client" && f.role !== "spouse",
  );
  const color = seriesColor(index) ?? "#cbd5e1";
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <div className="mb-3 flex items-center gap-2">
        <span
          className="h-2 w-2 rounded-full"
          style={{ backgroundColor: color }}
          aria-hidden
        />
        <span className="text-xs uppercase tracking-wide text-slate-400">{plan.label}</span>
      </div>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        <OwnerCard
          name={`${c.firstName} ${c.lastName}`.trim()}
          dob={c.dateOfBirth ?? null}
          retirementAge={c.retirementAge ?? null}
          lifeExpectancy={c.lifeExpectancy ?? null}
        />
        {c.spouseName && (
          <OwnerCard
            name={c.spouseName.trim()}
            dob={c.spouseDob ?? null}
            retirementAge={c.spouseRetirementAge ?? null}
            lifeExpectancy={c.spouseLifeExpectancy ?? null}
          />
        )}
      </div>
      {family.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-xs uppercase tracking-wide text-slate-400">Family</div>
          <div className="flex flex-wrap gap-2">
            {family.map((f) => {
              const age = ageFromDob(f.dateOfBirth);
              return (
                <div
                  key={f.id}
                  className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-200"
                >
                  {familyMemberDisplayName(f)}
                  <span className="ml-1 text-slate-400">
                    {age != null ? `· age ${age}` : ""} {f.relationship ? `· ${f.relationship}` : ""}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export function ClientProfileComparisonSection({ plans }: { plans: ComparisonPlan[] }) {
  const cols =
    plans.length === 1
      ? "grid-cols-1"
      : plans.length === 2
        ? "grid-cols-1 lg:grid-cols-2"
        : "grid-cols-1 md:grid-cols-3";
  return (
    <section className="px-6 py-8">
      <h2 className="mb-4 text-lg font-semibold text-slate-100">Client Profile</h2>
      <div className={`grid gap-4 ${cols}`}>
        {plans.map((p, i) => (
          <PlanColumn key={p.id} plan={p} index={i} />
        ))}
      </div>
    </section>
  );
}
