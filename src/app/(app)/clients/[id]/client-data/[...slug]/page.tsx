import { redirect } from "next/navigation";

interface PageProps {
  params: Promise<{ id: string; slug: string[] }>;
}

export default async function LegacyClientDataCatchAllRedirect({ params }: PageProps) {
  const { id, slug } = await params;
  redirect(`/clients/${id}/details/${slug.join("/")}`);
}
