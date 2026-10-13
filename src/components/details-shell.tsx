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
  const pathname = usePathname();
  // The map and the fact finder import need the width: the sidebar shrinks to icons.
  const isRail = pathname.endsWith("/details/map") || pathname.endsWith("/fact-finder");
  return (
    <div
      className={`grid items-start gap-6 ${isRail ? "grid-cols-[56px_1fr]" : "grid-cols-[220px_1fr]"}`}
    >
      <aside className="sticky top-[100px] h-[calc(100vh-100px)] border-r border-hair pr-4">
        <DetailsSidebar clientId={clientId} variant={isRail ? "rail" : "full"} />
      </aside>
      <section className="min-w-0">{children}</section>
    </div>
  );
}
