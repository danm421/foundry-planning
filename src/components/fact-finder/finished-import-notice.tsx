"use client";
// src/components/fact-finder/finished-import-notice.tsx
// What the fact finder page shows for a statement-chat import finished before
// the switch: it has no fact finder to show or edit, so just when it was
// finished (in the browser's timezone, as on the closed view) and the way back.
import Link from "next/link";
import { Card } from "@/components/card";
import { LocalDate } from "./local-date";

export function FinishedImportNotice({ clientId, finishedAt }: { clientId: string; finishedAt: string }) {
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <Link href={`/clients/${clientId}/details/import`} className="text-sm text-ink-3 underline-offset-2 hover:underline">
          ← Back to imports
        </Link>
        <h1 className="text-xl font-semibold text-ink">Fact finder import</h1>
      </header>
      <Card className="px-[var(--pad-card)] py-4">
        <p className="text-sm text-ink">
          This import was finished in statement chat on <LocalDate iso={finishedAt} />. Start a new import to change the
          plan.
        </p>
      </Card>
    </div>
  );
}
