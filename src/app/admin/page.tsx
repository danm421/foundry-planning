import Link from "next/link";
import { getOpsAdmin } from "@/lib/ops/ops-auth";

export const dynamic = "force-dynamic";

const LINKS = [
  { href: "/admin/growth", title: "Growth", desc: "Trials, conversion, activity, and who needs you." },
  { href: "/admin/orgs", title: "Organizations", desc: "Browse orgs, billing state, and detail." },
  { href: "/admin/beta-codes", title: "Beta codes", desc: "Mint and revoke founder access codes." },
  { href: "/admin/promo-codes", title: "Promo codes", desc: "Create checkout discounts and see who used them." },
];

const SUPERADMIN_LINKS = [
  { href: "/admin/ops-admins", title: "Ops admins", desc: "Grant and revoke ops console access." },
];

export default async function AdminHome() {
  const admin = await getOpsAdmin();
  const links =
    admin?.role === "superadmin" ? [...LINKS, ...SUPERADMIN_LINKS] : LINKS;

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-medium text-ink">Overview</h1>
      <div className="grid gap-3 sm:grid-cols-2">
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="rounded border border-hair p-4 transition hover:border-hair-2"
          >
            <div className="font-medium text-ink">{l.title}</div>
            <div className="text-sm text-ink-2">{l.desc}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
