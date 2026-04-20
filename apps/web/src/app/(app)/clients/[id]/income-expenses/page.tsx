import { redirect } from "next/navigation";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function LegacyIncomeExpensesRedirect({ params }: PageProps) {
  const { id } = await params;
  redirect(`/clients/${id}/client-data/income-expenses`);
}
