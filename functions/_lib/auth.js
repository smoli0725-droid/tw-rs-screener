import { createClerkClient } from '@clerk/backend';
import { isAllowedOrigin, json } from './cors.js';

function jwtKeyFromEnv(env) {
  const raw = env.CLERK_JWT_KEY;
  if (!raw || !String(raw).trim()) return undefined;
  return String(raw).replace(/\\n/g, '\n');
}

function authorizedParties(request, env) {
  const parties = new Set(['https://tradingvenator.pages.dev']);
  const origin = request.headers.get('Origin');
  if (origin && isAllowedOrigin(origin, env)) parties.add(origin);
  const extra = env?.ALLOWED_ORIGINS || '';
  for (const o of String(extra)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)) {
    parties.add(o);
  }
  parties.add('http://localhost:8080');
  parties.add('http://localhost:8788');
  parties.add('http://127.0.0.1:8080');
  parties.add('http://127.0.0.1:8788');
  return [...parties];
}

export async function requireUser(request, env) {
  const secretKey = env.CLERK_SECRET_KEY;
  const publishableKey = env.CLERK_PUBLISHABLE_KEY;
  if (!secretKey || secretKey.includes('CLERK_SECRET_KEY')) {
    return {
      response: json(
        { error: 'Server missing CLERK_SECRET_KEY' },
        503,
        request,
        env
      ),
    };
  }
  if (!publishableKey || publishableKey.includes('CLERK_PUBLISHABLE_KEY')) {
    return {
      response: json(
        { error: 'Server missing CLERK_PUBLISHABLE_KEY' },
        503,
        request,
        env
      ),
    };
  }

  try {
    const clerk = createClerkClient({
      secretKey,
      publishableKey,
      jwtKey: jwtKeyFromEnv(env),
    });
    const state = await clerk.authenticateRequest(request, {
      secretKey,
      publishableKey,
      jwtKey: jwtKeyFromEnv(env),
      authorizedParties: authorizedParties(request, env),
    });
    const signedIn =
      state.isAuthenticated === true ||
      state.isSignedIn === true ||
      state.status === 'signed-in';
    const auth = typeof state.toAuth === 'function' ? state.toAuth() : null;
    const userId = auth?.userId;
    if (!signedIn || !userId) {
      return {
        response: json({ error: 'Unauthorized' }, 401, request, env),
      };
    }
    return { userId };
  } catch (err) {
    console.error('Clerk authenticateRequest failed', err);
    return {
      response: json({ error: 'Unauthorized' }, 401, request, env),
    };
  }
}
