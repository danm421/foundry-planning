import Link from "next/link";
import type { ReactElement } from "react";
import { SparkleIcon } from "@/components/icons";

interface Props {
  clientId: string;
}

export default function EmptyHouseholdBanner({ clientId }: Props): ReactElement {
  return (
    <section className="flex items-center gap-4 rounded border border-accent/30 bg-accent/8 px-[var(--pad-card)] py-4">
      <span className="text-accent">
        <SparkleIcon width={22} height={22} />
      </span>
      <div className="flex flex-1 flex-col gap-0.5">
        <p className="text-[14px] font-semibold text-ink">
          New household — let&apos;s get it set up
        </p>
        <p className="text-[12.5px] text-ink-3">
          Add accounts and key details to populate this dashboard.
        </p>
      </div>
      <Link
        href={`/clients/${clientId}/client-data`}
        className="rounded-sm bg-accent px-3 py-1.5 text-[12px] font-semibold text-accent-on hover:bg-accent-ink"
      >
        Add accounts
      </Link>
    </section>
  );
}
