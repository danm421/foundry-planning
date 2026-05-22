import { CrmHouseholdForm } from "@/components/crm-household-form";

export default function NewCrmHouseholdPage() {
  return (
    <div className="mx-auto w-full max-w-2xl p-6">
      <h1 className="mb-6 text-2xl font-semibold text-ink">New Household</h1>
      <section className="rounded-[10px] border border-hair bg-card p-6 sm:p-7">
        <CrmHouseholdForm mode="create" />
      </section>
    </div>
  );
}
