// src/app/(app)/home/book/page.tsx
import type { ReactElement } from "react";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { Card } from "@/components/card";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { getBookBreakdown, type BookFocus } from "@/lib/home/book-breakdown";
import { BookBreakdownView } from "./_components/book-breakdown-view";

export default async function BookBreakdownPage({
  searchParams,
}: {
  searchParams: Promise<{ focus?: string }>;
}): Promise<ReactElement> {
  const { orgId, userId } = await requireOrgAndUser();
  const [{ orgRole }, { focus }] = await Promise.all([auth(), searchParams]);
  const resolvedFocus: BookFocus = focus === "held-away" ? "held-away" : "book";
  const data = await getBookBreakdown(orgId, userId, orgRole).catch(() => null);

  return (
    <div className="flex flex-col gap-4 p-[var(--pad-card)]">
      <div className="flex items-center justify-between">
        <h1 className="text-sm font-medium text-ink">Book value breakdown</h1>
        <Link href="/home" className="text-xs text-ink-3 hover:text-ink">
          ← Home
        </Link>
      </div>
      {data ? (
        <BookBreakdownView data={data} focus={resolvedFocus} />
      ) : (
        <Card className="px-[var(--pad-card)] py-8 text-center text-ink-3">
          Couldn’t load the book breakdown. Try again.
        </Card>
      )}
    </div>
  );
}
