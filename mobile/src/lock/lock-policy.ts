// Pure lock policy — no react-native imports (vitest-tested).

export const LOCK_GRACE_MS = 2 * 60 * 1000;

export interface LockPolicyInput {
  enabled: boolean;
  /** epoch ms when the app last went to background; null = cold start */
  lastActiveAt: number | null;
  now: number;
  graceMs: number;
}

export function shouldLock(i: LockPolicyInput): boolean {
  if (!i.enabled) return false;
  if (i.lastActiveAt == null) return true;
  return i.now - i.lastActiveAt > i.graceMs;
}
