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
    <div
      className={`grid items-start gap-6 ${isMap ? "grid-cols-[56px_1fr]" : "grid-cols-[220px_1fr]"}`}
    >
      <aside className="sticky top-[100px] h-[calc(100vh-100px)] border-r border-hair pr-4">
        <DetailsSidebar clientId={clientId} variant={isMap ? "rail" : "full"} />
      </aside>
      <section className="min-w-0">{children}</section>
    </div>
  );
}
