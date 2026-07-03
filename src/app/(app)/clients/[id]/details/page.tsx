import { redirect } from "next/navigation";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ scenario?: string }>;
}

export default async function ClientDataIndex({ params, searchParams }: PageProps) {
  const { id } = await params;
  const sp = await searchParams;
  const qs = sp.scenario ? `?scenario=${encodeURIComponent(sp.scenario)}` : "";
  redirect(`/clients/${id}/details/net-worth${qs}`);
}
