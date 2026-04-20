import {
  runWithActingContext,
  getCurrentActingContext,
  type ActingContext,
} from "@foundry/auth";

export function adminQuery<T>(
  ctx: ActingContext,
  fn: () => Promise<T>,
): Promise<T> {
  return runWithActingContext(ctx, fn);
}

export function getScopedContext(): ActingContext | undefined {
  return getCurrentActingContext();
}
