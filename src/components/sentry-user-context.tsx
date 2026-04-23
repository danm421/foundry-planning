"use client";

import { useEffect } from "react";
import { useAuth, useUser } from "@clerk/nextjs";
import * as Sentry from "@sentry/nextjs";

export function SentryUserContext() {
  const { user, isLoaded: userLoaded } = useUser();
  const { orgId, orgSlug, isLoaded: authLoaded } = useAuth();

  useEffect(() => {
    if (!userLoaded || !authLoaded) return;

    if (!user) {
      Sentry.setUser(null);
      Sentry.setTag("org_id", null);
      Sentry.setTag("org_slug", null);
      return;
    }

    Sentry.setUser({ id: user.id });
    Sentry.setTag("org_id", orgId ?? null);
    Sentry.setTag("org_slug", orgSlug ?? null);
  }, [user, userLoaded, authLoaded, orgId, orgSlug]);

  return null;
}
