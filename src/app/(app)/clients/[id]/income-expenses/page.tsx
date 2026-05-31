import { redirect } from "next/navigation";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ scenario?: string }>;
}

export default async function LegacyIncomeExpensesRedirect({ params, searchParams }: PageProps) {
  const { id } = await params;
  const sp = await searchParams;
  const qs = sp.scenario ? `?scenario=${encodeURIComponent(sp.scenario)}` : "";
  redirect(`/clients/${id}/details/income-expenses${qs}`);
}
