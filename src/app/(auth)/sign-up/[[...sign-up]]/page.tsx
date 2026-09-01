import { SignUp } from "@clerk/nextjs";
import { dark } from "@clerk/themes";
import { normalizePlan } from "@/lib/billing/checkout";

/**
 * Two very different people arrive at this URL, and both now get the form.
 *
 * Invited ones — a portal client from `sendPortalInvite`, or the firm admin the
 * sales-path checkout webhook invites — arrive carrying a Clerk hand-off param
 * (`__clerk_ticket`, `__clerk_status`, …), as does anyone Clerk has walked into
 * a child step of this catch-all. They already belong to a firm, so Clerk's own
 * post-sign-up destination is correct and we must NOT override it.
 *
 * Everyone else came from the storefront's "Start trial". They get the account
 * first, then `/welcome`, where they name their firm and pay. Their Clerk org
 * is deliberately not created until the payment lands — see the spec.
 */
function isClerkFlow(
  query: Record<string, string | string[] | undefined>,
  segments: string[] | undefined,
): boolean {
  if (Object.keys(query).some((key) => key.startsWith("__clerk_"))) return true;
  // A child step of this catch-all (`/sign-up/verify-email-address`, …). Clerk
  // walks BOTH kinds of visitor through these, and an invited user's ticket may
  // be gone from the URL by the time they get here — so a bare segment is not
  // evidence of either one. Default to Clerk's own destination, which is the
  // safe answer for an invited user, UNLESS the URL still carries the
  // storefront's `?plan=`: only a self-serve buyer ever has that, and no
  // invitation link sets it. When Clerk does not carry the query string
  // forward, this reads exactly as it did before.
  if (segments && segments.length > 0) return query.plan === undefined;
  return false;
}

export default async function SignUpPage({
  searchParams,
  params,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
  params: Promise<{ "sign-up"?: string[] }>;
}) {
  const [query, { "sign-up": segments }] = await Promise.all([searchParams, params]);

  // True for anyone Clerk itself put here: an invited portal client, an invited
  // firm admin, or a step Clerk walked a visitor into. False only for someone
  // who arrived from the storefront under their own steam — the buyer.
  const clerkFlow = isClerkFlow(query, segments);

  const forceRedirectUrl = clerkFlow
    ? undefined
    : `/welcome?plan=${normalizePlan(query.plan)}`;

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
      {/* Only the self-serve buyer is starting a trial. An advisor's portal
          client arrives here on an invitation, buys nothing, and has nothing to
          cancel — telling them otherwise is a plain misstatement of fact. */}
      {clerkFlow ? null : (
        <p className="mt-2 text-sm text-[var(--color-ink-3)]">
          14-day free trial · cancel anytime
        </p>
      )}

      <div className="mt-7 [&_.cl-rootBox]:w-full [&_.cl-cardBox]:w-full [&_.cl-card]:!bg-transparent [&_.cl-card]:!border-0 [&_.cl-card]:!p-0 [&_.cl-card]:!shadow-none [&_.cl-header]:hidden [&_.cl-footer]:!bg-transparent">
        <SignUp
          forceRedirectUrl={forceRedirectUrl}
          signInUrl="/sign-in"
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
