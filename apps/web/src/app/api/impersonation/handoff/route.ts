import { NextResponse } from 'next/server';
import { verifyImpersonationToken, hashImpersonationToken, ImpersonationTokenError } from '@foundry/auth';
import { impersonationSessionRepo } from '@/lib/impersonation-session-repo-singleton';

export const runtime = 'nodejs';

const COOKIE = 'foundry_impersonation';
const COOKIE_MAX_AGE = 30 * 60;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get('t');
  if (!token) return new NextResponse('missing token', { status: 400 });

  const secret = process.env.IMPERSONATION_SIGNING_SECRET;
  if (!secret) return new NextResponse('server not configured', { status: 500 });

  let claims;
  try {
    claims = await verifyImpersonationToken(token, secret);
  } catch (err) {
    if (err instanceof ImpersonationTokenError) return new NextResponse('invalid token', { status: 401 });
    throw err;
  }

  const hash = hashImpersonationToken(token);
  const session = await impersonationSessionRepo.consumeHandoffToken(hash);
  if (!session) return new NextResponse('token already consumed or session inactive', { status: 401 });
  if (session.sessionId !== claims.sessionId) return new NextResponse('sessionId mismatch', { status: 401 });

  const res = NextResponse.redirect(new URL('/clients', req.url), 302);
  res.cookies.set({
    name: COOKIE,
    value: session.sessionId,
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  });
  return res;
}
