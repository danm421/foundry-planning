import { SignJWT, jwtVerify, errors as joseErrors } from 'jose';
import { createHash } from 'node:crypto';

export class ImpersonationTokenError extends Error {
  constructor(reason: string) { super(`Impersonation token invalid: ${reason}`); }
}

export type ImpersonationClaims = {
  sessionId: string;
  actorAdminId: string;
  advisorClerkUserId: string;
  firmId: string;
};

const ALG = 'HS256';
const TTL_SECONDS = 60;

export async function signImpersonationToken(
  claims: ImpersonationClaims,
  secret: string,
): Promise<{ token: string; tokenHash: Buffer }> {
  if (secret.length < 32) throw new Error('IMPERSONATION_SIGNING_SECRET must be >= 32 chars');
  const key = new TextEncoder().encode(secret);
  const token = await new SignJWT({ ...claims })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime(`${TTL_SECONDS}s`)
    .sign(key);
  return { token, tokenHash: hashImpersonationToken(token) };
}

export async function verifyImpersonationToken(
  token: string,
  secret: string,
): Promise<ImpersonationClaims> {
  const key = new TextEncoder().encode(secret);
  try {
    const { payload } = await jwtVerify(token, key, { algorithms: [ALG] });
    const { sessionId, actorAdminId, advisorClerkUserId, firmId } = payload as Record<string, unknown>;
    if (
      typeof sessionId !== 'string' ||
      typeof actorAdminId !== 'string' ||
      typeof advisorClerkUserId !== 'string' ||
      typeof firmId !== 'string'
    ) {
      throw new ImpersonationTokenError('missing claim');
    }
    return { sessionId, actorAdminId, advisorClerkUserId, firmId };
  } catch (err) {
    if (err instanceof ImpersonationTokenError) throw err;
    if (err instanceof joseErrors.JOSEError) throw new ImpersonationTokenError(err.message);
    throw new ImpersonationTokenError(String(err));
  }
}

export function hashImpersonationToken(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}
