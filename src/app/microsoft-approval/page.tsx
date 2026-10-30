import type { Metadata } from "next";
import type { ReactElement } from "react";

export const metadata: Metadata = { title: "Microsoft 365 approval" };

const MESSAGES = {
  approved: "Microsoft 365 is approved for your organization. You can close this tab.",
  declined: "Microsoft 365 wasn't approved. Whoever sent you this link can send it again.",
  expired: "This approval link has expired or was already used. Ask your Foundry admin for a new one.",
} as const;

/**
 * Where Microsoft's admin-consent callback lands someone who isn't signed in
 * to Foundry — usually an organization's IT admin, sent the approval link by
 * an advisor, with no Foundry account. PUBLIC and static: `result` only picks
 * the message, and anything unrecognised reads as expired.
 */
export default async function MicrosoftApprovalPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}): Promise<ReactElement> {
  const { result } = await searchParams;
  const message =
    result === "approved" || result === "declined" ? MESSAGES[result] : MESSAGES.expired;

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4 py-12">
      <section className="w-full max-w-md rounded-[10px] border border-hair bg-card p-6 sm:p-7">
        <span className="font-mono text-[0.68rem] uppercase tracking-[0.18em] text-ink-3">
          Microsoft 365
        </span>
        <p className="mt-3 text-[15px] leading-relaxed text-ink">{message}</p>
      </section>
    </div>
  );
}
