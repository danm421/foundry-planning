import { redirect } from "next/navigation";
import { SignUp } from "@clerk/nextjs";
import { dark } from "@clerk/themes";
import { readPendingBeta } from "@/lib/billing/beta-cookie";

export default async function BetaSignUpPage() {
  // No validated code in the cookie → send them back to enter one.
  if (!(await readPendingBeta())) redirect("/beta");

  return (
    <section className="rise-in relative rounded-2xl border border-[var(--color-accent)]/40 bg-gradient-to-b from-[var(--color-accent)]/[0.06] to-transparent p-7 shadow-[0_30px_80px_-30px_rgba(31,158,140,0.35)] sm:p-9">
      <div className="mb-5 flex items-center gap-3">
        <span className="font-mono text-[0.68rem] uppercase tracking-[0.18em] text-[var(--color-ink-3)]">
          Beta access
        </span>
        <span className="h-px w-12 bg-[var(--color-hair-2)]" />
      </div>
      <h1 className="text-balance text-3xl font-semibold leading-[1.1] tracking-[-0.02em] text-[var(--color-ink)] sm:text-4xl">
        Create your account<span className="dot">.</span>
      </h1>
      <p className="mt-2 text-sm text-[var(--color-ink-3)]">
        Your beta code is applied — finish creating your account to enter the app.
      </p>
      <div className="mt-7 [&_.cl-rootBox]:w-full [&_.cl-cardBox]:w-full [&_.cl-card]:!bg-transparent [&_.cl-card]:!border-0 [&_.cl-card]:!p-0 [&_.cl-card]:!shadow-none [&_.cl-header]:hidden [&_.cl-footer]:!bg-transparent">
        <SignUp
          forceRedirectUrl="/beta/redeem"
          signInUrl="/sign-in"
          appearance={{
            baseTheme: dark,
            variables: {
              colorPrimary: "var(--color-accent)",
              colorPrimaryForeground: "var(--color-accent-on)",
              colorBackground: "transparent",
              colorForeground: "var(--color-ink)",
              colorMutedForeground: "var(--color-ink-2)",
              colorInput: "var(--color-card-2)",
              colorInputForeground: "var(--color-ink)",
              colorNeutral: "var(--color-ink)",
              borderRadius: "6px",
              fontFamily: "var(--font-inter)",
            },
            elements: {
              header: "!hidden",
              logoBox: "!hidden",
              formButtonPrimary:
                "bg-[var(--color-accent)] hover:bg-[var(--color-accent-ink)] text-[var(--color-accent-on)] font-semibold transition-colors",
              socialButtonsBlockButton:
                "border-[var(--color-hair-2)] hover:border-[var(--color-accent)] transition-colors",
              formFieldInput:
                "border-[var(--color-hair-2)] bg-[var(--color-card)] focus-within:border-[var(--color-accent)]",
              dividerLine: "bg-[var(--color-hair)]",
              dividerText:
                "text-[var(--color-ink-3)] font-mono uppercase tracking-[0.12em] text-[0.65rem]",
              footerAction: "text-[var(--color-ink-3)]",
              footerActionLink:
                "text-[var(--color-accent)] hover:text-[var(--color-accent-ink)] font-semibold",
              formFieldLabel: "text-[var(--color-ink-2)]",
              identityPreviewText: "text-[var(--color-ink-2)]",
              identityPreviewEditButton:
                "text-[var(--color-accent)] hover:text-[var(--color-accent-ink)]",
            },
          }}
        />
      </div>
    </section>
  );
}
