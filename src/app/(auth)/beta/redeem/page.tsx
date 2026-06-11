import { RedeemRunner } from "./redeem-runner";

export default function BetaRedeemPage() {
  return (
    <section className="rise-in relative rounded-2xl border border-[var(--color-accent)]/40 bg-gradient-to-b from-[var(--color-accent)]/[0.06] to-transparent p-7 shadow-[0_30px_80px_-30px_rgba(31,158,140,0.35)] sm:p-9">
      <h1 className="text-balance text-3xl font-semibold leading-[1.1] tracking-[-0.02em] text-[var(--color-ink)] sm:text-4xl">
        Finishing setup<span className="dot">.</span>
      </h1>
      <RedeemRunner />
    </section>
  );
}
