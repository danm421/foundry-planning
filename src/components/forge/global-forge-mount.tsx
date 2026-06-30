// src/components/forge/global-forge-mount.tsx
"use client";

import { usePathname } from "next/navigation";
import { ForgeProvider } from "./forge-provider";
import { ForgePanel } from "./forge-panel";
import { ForgeLauncher } from "./forge-launcher";

/** A path is client-scoped when it is under /clients/<id>/... — i.e. /clients
 *  followed by a non-empty segment. The bare /clients list is NOT client-scoped. */
function isClientScopedPath(pathname: string): boolean {
  return /^\/clients\/[^/]+/.test(pathname);
}

/**
 * Clientless Forge mount for the shared (app) shell. Gives every non-client page
 * (the /clients list, /tasks, /cma, /settings, …) an always-available Forge for
 * product help. Suppresses itself on /clients/<id>/* where ClientLayout already
 * mounts the client-scoped Forge — otherwise two launchers would stack.
 */
export function GlobalForgeMount({ enabled }: { enabled: boolean }) {
  const pathname = usePathname();
  if (!enabled) return null;
  if (isClientScopedPath(pathname)) return null;
  return (
    <ForgeProvider clientId={null}>
      <ForgePanel clientId={null} scenarioNames={{}} />
      <ForgeLauncher />
    </ForgeProvider>
  );
}
