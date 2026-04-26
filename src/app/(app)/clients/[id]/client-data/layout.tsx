import ClientDataSidebar from "@/components/client-data-sidebar";

interface ClientDataLayoutProps {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}

export default async function ClientDataLayout({
  children,
  params,
}: ClientDataLayoutProps) {
  const { id } = await params;

  return (
    <div className="grid grid-cols-[220px_1fr] gap-6">
      <aside className="border-r border-gray-800 pr-4">
        <ClientDataSidebar clientId={id} />
      </aside>
      <section className="min-w-0">{children}</section>
    </div>
  );
}
