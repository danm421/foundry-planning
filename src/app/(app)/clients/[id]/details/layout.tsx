import DetailsSidebar from "@/components/details-sidebar";

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
    <div className="grid grid-cols-[220px_1fr] items-start gap-6">
      <aside className="sticky top-[100px] h-[calc(100vh-100px)] border-r border-hair pr-4">
        <DetailsSidebar clientId={id} />
      </aside>
      <section className="min-w-0">{children}</section>
    </div>
  );
}
