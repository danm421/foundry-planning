import { notFound } from "next/navigation";
import { requireBetaOperator } from "@/lib/authz";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  try {
    await requireBetaOperator();
  } catch {
    notFound(); // don't reveal the route to non-operators
  }
  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <div className="mx-auto max-w-5xl px-6 py-10">{children}</div>
    </div>
  );
}
