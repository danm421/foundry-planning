import Link from "next/link";
import type { ReactElement } from "react";
import { requireOrgId } from "@/lib/db-helpers";
import { findClientInFirm } from "@/lib/db-scoping";
import { notFound } from "next/navigation";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ scenario?: string }>;
}

interface AnalysisCard {
  title: string;
  description: string;
  href: string | null;
  available: boolean;
}

export default async function AnalysisHubPage({
  params,
  searchParams,
}: PageProps): Promise<ReactElement> {
  const firmId = await requireOrgId();
  const { id: clientId } = await params;
  const sp = await searchParams;

  const inFirm = await findClientInFirm(clientId, firmId);
  if (!inFirm) notFound();

  const scenarioParam = sp.scenario;
  const retirementHref = `/clients/${clientId}/analysis/retirement${
    scenarioParam ? `?scenario=${scenarioParam}` : ""
  }`;

  const cards: AnalysisCard[] = [
    {
      title: "Retirement",
      description: "Projection runway, funded years, and income coverage through end of plan.",
      href: retirementHref,
      available: true,
    },
    {
      title: "Education",
      description: "College-funding gap analysis and savings strategy.",
      href: null,
      available: false,
    },
    {
      title: "Life Insurance",
      description: "Survivor income need and policy adequacy review.",
      href: null,
      available: false,
    },
  ];

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-ink">Analyses</h1>
      <div className="grid grid-cols-1 gap-[var(--gap-grid)] sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) =>
          card.available && card.href ? (
            <Link
              key={card.title}
              href={card.href}
              className="block rounded bg-card border border-hair p-[var(--pad-card)] transition-colors duration-200 hover:bg-card-hover cursor-pointer"
            >
              <h2 className="mb-1 text-base font-medium text-ink">{card.title}</h2>
              <p className="text-sm text-ink-3">{card.description}</p>
            </Link>
          ) : (
            <div
              key={card.title}
              aria-disabled="true"
              className="rounded bg-card border border-hair p-[var(--pad-card)] opacity-50 cursor-not-allowed"
            >
              <div className="mb-1 flex items-center justify-between">
                <h2 className="text-base font-medium text-ink-4">{card.title}</h2>
                <span className="text-[11px] text-ink-4 border border-hair rounded-sm px-1.5 py-0.5">
                  Coming soon
                </span>
              </div>
              <p className="text-sm text-ink-4">{card.description}</p>
            </div>
          ),
        )}
      </div>
    </div>
  );
}
