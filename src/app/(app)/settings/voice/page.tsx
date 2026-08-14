import type { ReactElement } from "react";
import { auth } from "@clerk/nextjs/server";
import { VoiceProfilePanel } from "./voice-profile-panel";

// No role gate here, and none in the tab strip either: a voice profile is per
// advisor, so every member of the firm has one of their own to write. Only the
// "save this for the whole firm" checkbox inside the panel is admin-only, and
// both writing routes re-check the role server-side with
// `requireOrgAdminOrOwner` — the flag below decides what is OFFERED, never what
// is allowed.
export default async function VoiceSettingsPage(): Promise<ReactElement> {
  const { orgId, userId, orgRole } = await auth();
  if (!orgId || !userId) {
    return <p className="text-sm text-ink-3">Sign in to manage your writing voice.</p>;
  }
  const isAdmin = orgRole === "org:admin";

  // `userId` is what lets the panel tell the advisor's own style note from the
  // firm's: `GET /api/story-voice` answers with whichever applies to them and
  // stamps `advisorUserId` on it, so a note that came back under some other id
  // is the firm's. Passed down rather than fetched in the browser, which has no
  // way to learn its own Clerk user id.
  return <VoiceProfilePanel isAdmin={isAdmin} userId={userId} />;
}
