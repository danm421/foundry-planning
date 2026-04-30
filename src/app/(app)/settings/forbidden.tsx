import type { ReactElement } from "react";
import Link from "next/link";

interface Props {
  requiredRole: string;
}

export default function Forbidden({ requiredRole }: Props): ReactElement {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-base font-medium text-ink">Not available for your role</h2>
      <p className="text-sm text-ink-3">
        This page requires the <strong>{requiredRole}</strong> role.
      </p>
      <Link href="/settings/team" className="text-sm text-ink-2 underline">
        ← Back to Team settings
      </Link>
    </div>
  );
}
