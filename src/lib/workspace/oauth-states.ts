// src/lib/workspace/oauth-states.ts
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { workspaceOauthStates } from "@/db/schema";
import { generateState } from "@/lib/integrations/pkce";
import type { WorkspaceProvider } from "./types";

export type WorkspaceOauthStateRow = {
  firmId: string;
  provider: WorkspaceProvider;
  kind: "admin_consent" | "user_connect";
  userId: string;
  codeVerifier: string | null;
};

export async function createWorkspaceOauthState(input: {
  firmId: string;
  provider: WorkspaceProvider;
  kind: "admin_consent" | "user_connect";
  userId: string;
  codeVerifier: string | null;
  ttlMs: number;
}): Promise<string> {
  const state = generateState();
  await db.insert(workspaceOauthStates).values({
    firmId: input.firmId,
    provider: input.provider,
    kind: input.kind,
    userId: input.userId,
    state,
    codeVerifier: input.codeVerifier,
    expiresAt: new Date(Date.now() + input.ttlMs),
  });
  return state;
}

/** Single use: the row is deleted as it is read. An expired state is deleted and yields null. */
export async function consumeWorkspaceOauthState(state: string): Promise<WorkspaceOauthStateRow | null> {
  const [row] = await db
    .delete(workspaceOauthStates)
    .where(eq(workspaceOauthStates.state, state))
    .returning();
  if (!row || row.expiresAt.getTime() <= Date.now()) return null;
  return {
    firmId: row.firmId,
    provider: row.provider,
    kind: row.kind,
    userId: row.userId,
    codeVerifier: row.codeVerifier,
  };
}
