import { SparkleIcon } from "@/components/icons";
import QuickCreateForm from "./quick-create-form";

export default function NewClientPage() {
  return (
    <div className="mx-auto w-full max-w-xl px-4 py-12 sm:px-6">
      <div className="mb-8 flex flex-col items-center text-center">
        <span
          className="mb-4 flex h-12 w-12 items-center justify-center rounded-[10px] border border-accent/30 bg-accent/10 text-accent-ink"
          aria-hidden="true"
        >
          <SparkleIcon width={22} height={22} />
        </span>
        <h1 className="text-[24px] font-semibold leading-tight text-ink">Add a new client</h1>
        <p className="mt-2 max-w-sm text-[14px] leading-relaxed text-ink-3">
          Start with the basics — we&apos;ll walk you through household, accounts, cash flow, and the rest. Everything is editable later.
        </p>
      </div>
      <section className="rounded-[10px] border border-hair bg-card p-6 sm:p-7">
        <QuickCreateForm />
      </section>
    </div>
  );
}
