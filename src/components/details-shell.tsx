"use client";
import { usePathname } from "next/navigation";
import DetailsSidebar from "@/components/details-sidebar";

export default function DetailsShell({
  clientId,
  children,
}: {
  clientId: string;
  children: React.ReactNode;
}) {
  const isMap = usePathname().endsWith("/details/map");
  return (
    // Desktop: the layout above fills the viewport, so each pane scrolls on its
    // own and the sidebar never rides along with the content. Below lg the
    // page scrolls and the sidebar stays sticky.
    <div
      className={`grid min-h-0 flex-1 items-start gap-6 lg:items-stretch ${isMap ? "grid-cols-[56px_1fr]" : "grid-cols-[220px_1fr]"}`}
    >
      <aside className="sticky top-[100px] h-[calc(100vh-100px)] border-r border-hair pr-4 lg:static lg:h-auto lg:min-h-0 lg:overflow-y-auto">
        <DetailsSidebar clientId={clientId} variant={isMap ? "rail" : "full"} />
      </aside>
      <section className="min-w-0 lg:min-h-0 lg:overflow-y-auto lg:pb-6">{children}</section>
    </div>
  );
}
