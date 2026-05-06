import { redirect } from "next/navigation";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function AssetsIndexPage({ params }: PageProps) {
  const { id } = await params;
  redirect(`/clients/${id}/assets/balance-sheet-report`);
}
