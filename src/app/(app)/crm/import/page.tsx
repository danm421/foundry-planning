import Link from "next/link";
import { CrmImportWizard } from "@/components/crm-import-wizard";

export default function CrmImportPage() {
  return (
    <div className="mx-auto w-full max-w-5xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Bulk import households</h1>
          <p className="mt-1 text-[13px] text-ink-3">
            Upload a CSV to create multiple households at once. Duplicate
            matches are flagged so you can decide what to keep.
          </p>
        </div>
        <Link
          href="/crm"
          className="text-[13px] text-ink-3 transition-colors hover:text-ink-2"
        >
          Back to CRM
        </Link>
      </div>
      <CrmImportWizard />
    </div>
  );
}
