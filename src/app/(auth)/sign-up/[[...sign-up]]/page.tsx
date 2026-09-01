import { redirect } from "next/navigation";
import { SignUp } from "@clerk/nextjs";
import { dark } from "@clerk/themes";
import { normalizePlan } from "@/lib/billing/checkout";

/**
 * Two very different people arrive at this URL.
 *
 * Invited ones — a portal client from `sendPortalInvite`, or the firm admin
 * the checkout webhook invites — arrive carrying a Clerk hand-off param
 * (`__clerk_ticket`, `__clerk_status`, …) and need the sign-up form. So does
 * anyone Clerk has already walked into a child step of this catch-all
 * (`/sign-up/verify-email-address`, `/continue`, `/sso-callback`), which it
 * navigates to with no query params at all.
 *
 * Everyone else arrives from the storefront's "Start trial" buttons. Signing
 * them up here would mint a Clerk account with no firm and no subscription,
 * and self-serve org creation is disabled — so they would dead-end on
 * /select-organization. They need Stripe Checkout, which is what actually
 * provisions a firm and emails them an invitation.
 */
function isClerkFlow(
  query: Record<string, string | string[] | undefined>,
  segments: string[] | undefined,
): boolean {
  if (segments && segments.length > 0) return true;
  return Object.keys(query).some((key) => key.startsWith("__clerk_"));
}

export default async function SignUpPage({
  searchParams,
  params,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
  params: Promise<{ "sign-up"?: string[] }>;
}) {
  const [query, { "sign-up": segments }] = await Promise.all([searchParams, params]);

  if (!isClerkFlow(query, segments)) {
    redirect(`/api/checkout/start?plan=${normalizePlan(query.plan)}`);
  }

  return (
    <section className="rise-in relative rounded-2xl border border-[var(--color-accent)]/40 bg-gradient-to-b from-[var(--color-accent)]/[0.06] to-transparent p-7 shadow-[0_30px_80px_-30px_rgba(31,158,140,0.35)] sm:p-9">
      <div className="mb-5 flex items-center gap-3">
        <span className="font-mono text-[0.68rem] uppercase tracking-[0.18em] text-[var(--color-ink-3)]">
          Start
        </span>
        <span className="h-px w-12 bg-[var(--color-hair-2)]" />
      </div>

      <h1 className="text-balance text-3xl font-semibold leading-[1.1] tracking-[-0.02em] text-[var(--color-ink)] sm:text-4xl">
        Create your account<span className="dot">.</span>
      </h1>
      <p className="mt-2 text-sm text-[var(--color-ink-3)]">
        14-day free trial · cancel anytime
      </p>

      <div className="mt-7 [&_.cl-rootBox]:w-full [&_.cl-cardBox]:w-full [&_.cl-card]:!bg-transparent [&_.cl-card]:!border-0 [&_.cl-card]:!p-0 [&_.cl-card]:!shadow-none [&_.cl-header]:hidden [&_.cl-footer]:!bg-transparent">
        <SignUp
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
