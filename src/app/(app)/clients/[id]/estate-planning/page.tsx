import { redirect } from "next/navigation";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}

// The Estate Flow report is now the default view for the Estate Planning
// section. The legacy "Planning" projection panel has been archived (its
// files remain under ./estate-planning-content.tsx, ./projection/, etc., and
// are referenced by the embedded Comparison tab on the Estate Flow page).
export default async function EstatePlanningPage({
  params,
  searchParams,
}: PageProps) {
  const { id: clientId } = await params;
  const sp = await searchParams;
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    if (value !== undefined) qs.set(key, value);
  }
  const suffix = qs.toString();
  redirect(
    `/clients/${clientId}/estate-planning/estate-flow${suffix ? `?${suffix}` : ""}`,
  );
}
