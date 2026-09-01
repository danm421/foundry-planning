import { OrganizationList } from "@clerk/nextjs";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { LANDING_PATH } from "@/lib/routes";

// Landing page signed-in users hit when they have no active Clerk org.
// Without this, requireOrgId() would 401 them on every API route and
// the app would dead-end with no UX for picking or creating an org.
// Middleware forces a redirect here so no downstream route has to
// handle the orgless case.
//
// Two populations arrive with no active org, and they need opposite things:
//
//  - Someone who already belongs to a firm (or has a pending invitation to
//    one) just hasn't activated it yet. They get Clerk's picker.
//  - Someone who belongs to no firm at all — typically a visitor who made an
//    account before buying — has nothing to pick. Clerk's picker would offer
//    them a "create organization" form, and self-serve org creation is
//    disabled instance-wide (bare orgs shadow provisioning and break billing
//    state), so that form can only ever fail with "Organization creation is
//    not enabled for this user". They get the trial instead, which is what
//    actually creates a firm.

/**
 * Fail-safe: a Clerk outage returns `true` so a real member sees the picker
 * rather than being told to buy a seat they already have.
 */
async function belongsToAFirm(userId: string): Promise<boolean> {
  try {
    const cc = await clerkClient();
    const [memberships, invitations] = await Promise.all([
      cc.users.getOrganizationMembershipList({ userId }),
      // Pending only — a revoked or already-accepted invitation is not a way in.
      cc.users.getOrganizationInvitationList({ userId, status: "pending" }),
    ]);
    return memberships.totalCount > 0 || invitations.totalCount > 0;
  } catch (err) {
    console.error("[select-organization] could not read Clerk memberships", err);
    return true;
  }
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-paper p-6">
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}

function NoFirmNotice() {
  return (
    <section className="card rise-in p-7 sm:p-9">
      <div className="mb-5 flex items-center gap-3">
        <span className="font-mono text-[0.68rem] uppercase tracking-[0.18em] text-ink-3">
          Almost there
        </span>
        <span className="h-px w-12 bg-hair-2" />
      </div>

      <h1 className="text-balance text-2xl font-semibold leading-[1.15] tracking-[-0.02em] text-ink sm:text-3xl">
        Your account isn&rsquo;t linked to a firm<span className="dot">.</span>
      </h1>

      <p className="mt-3 text-sm leading-relaxed text-ink-2">
        Every plan in Foundry Planning lives inside a firm, and this account
        isn&rsquo;t in one yet.
      </p>

      <a href="/welcome" className="btn-primary mt-7">
        Set up your firm
      </a>

      <p className="mt-6 text-sm leading-relaxed text-ink-3">
        Already part of a firm that uses Foundry? Ask an admin there to invite
        you — the email link they send brings you straight in.
      </p>

      <p className="mt-4 text-sm leading-relaxed text-ink-3">
        Not what you expected? Email{" "}
        <a
          href="mailto:support@foundryplanning.com"
          className="text-accent hover:text-accent-ink"
        >
          support@foundryplanning.com
        </a>
        .
      </p>
    </section>
  );
}

export default async function SelectOrganizationPage() {
  const { userId } = await auth();

  if (userId && !(await belongsToAFirm(userId))) {
    return (
      <Shell>
        <NoFirmNotice />
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-semibold text-ink">Choose an organization</h1>
        <p className="mt-2 text-sm text-ink-2">
          Foundry Planning is scoped by firm. Pick the one you want to work in.
        </p>
      </div>
      <OrganizationList
        afterCreateOrganizationUrl={LANDING_PATH}
        afterSelectOrganizationUrl={LANDING_PATH}
        hidePersonal
        skipInvitationScreen
      />
    </Shell>
  );
}
