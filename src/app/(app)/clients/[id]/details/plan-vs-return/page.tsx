import { redirect } from "next/navigation";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ year?: string; scenario?: string }>;
}

/** Plan vs. Return is a view inside the Tax Analysis section now. This forwards
 *  the links and bookmarks that still point at the old standalone screen,
 *  carrying `?year=` and `?scenario=` through untouched — the section parses
 *  both the same way this page used to. */
export default async function PlanVsReturnRedirect({ params, searchParams }: PageProps) {
  const { id } = await params;
  const sp = await searchParams;
  const q = new URLSearchParams({ view: "plan-vs-return" });
  if (sp.year) q.set("year", sp.year);
  if (sp.scenario) q.set("scenario", sp.scenario);
  redirect(`/clients/${id}/details/tax-analysis?${q}`);
}
