import { BetaCodeForm } from "./beta-code-form";

export default async function BetaPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const { code } = await searchParams;
  return (
    <section className="rise-in relative rounded-2xl border border-[var(--color-accent)]/40 bg-gradient-to-b from-[var(--color-accent)]/[0.06] to-transparent p-7 shadow-[0_30px_80px_-30px_rgba(31,158,140,0.35)] sm:p-9">
      <div className="mb-5 flex items-center gap-3">
        <span className="font-mono text-[0.68rem] uppercase tracking-[0.18em] text-[var(--color-ink-3)]">
          Beta access
        </span>
        <span className="h-px w-12 bg-[var(--color-hair-2)]" />
      </div>
      <h1 className="text-balance text-3xl font-semibold leading-[1.1] tracking-[-0.02em] text-[var(--color-ink)] sm:text-4xl">
        Redeem your beta invite<span className="dot">.</span>
      </h1>
      <p className="mt-2 text-sm text-[var(--color-ink-3)]">
        Enter your code and firm name, then create your account. No card required.
      </p>
      <BetaCodeForm initialCode={code ?? ""} />
    </section>
  );
}
