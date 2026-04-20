import { redirect } from "next/navigation";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function LegacyBalanceSheetRedirect({ params }: PageProps) {
  const { id } = await params;
  redirect(`/clients/${id}/client-data/balance-sheet`);
}
