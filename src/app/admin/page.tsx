import Link from "next/link";

export const dynamic = "force-dynamic";

const LINKS = [
  { href: "/admin/orgs", title: "Organizations", desc: "Browse orgs, billing state, and detail." },
  { href: "/admin/beta-codes", title: "Beta codes", desc: "Mint and revoke founder access codes." },
];

export default function AdminHome() {
  return (
    <div className="space-y-6">
      <h1 className="text-lg font-medium text-ink">Overview</h1>
      <div className="grid gap-3 sm:grid-cols-2">
        {LINKS.map((l) => (
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
