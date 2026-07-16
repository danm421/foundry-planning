import { SignIn } from "@clerk/nextjs";
import { dark } from "@clerk/themes";

export default function SignInPage() {
  return (
    <section className="rise-in relative rounded-2xl border border-[var(--color-hair)] bg-[var(--color-card)]/40 p-7 sm:p-9">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/fp-icon.svg"
        alt="Foundry Planning"
        className="mb-6 h-12 w-12 rounded-xl"
      />

      <div className="mb-5 flex items-center gap-3">
        <span className="font-mono text-[0.68rem] uppercase tracking-[0.18em] text-[var(--color-ink-3)]">
          Welcome back
        </span>
        <span className="h-px w-12 bg-[var(--color-hair-2)]" />
      </div>

      <h1 className="text-balance text-3xl font-semibold leading-[1.1] tracking-[-0.02em] text-[var(--color-ink)] sm:text-4xl">
        Sign in to Foundry<span className="dot">.</span>
      </h1>
      <p className="mt-2 text-sm text-[var(--color-ink-3)]">
        Plans that hold up.
      </p>

      <div className="mt-7 [&_.cl-rootBox]:w-full [&_.cl-cardBox]:w-full [&_.cl-card]:!bg-transparent [&_.cl-card]:!border-0 [&_.cl-card]:!p-0 [&_.cl-card]:!shadow-none [&_.cl-header]:hidden [&_.cl-footer]:!bg-transparent">
        <SignIn
          forceRedirectUrl="/home"
          appearance={{
            theme: dark,
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
