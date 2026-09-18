import { createClerkClient } from '@clerk/backend';
import { json } from './cors.js';
import { isSiteOwner } from './owner.js';

function jwtKeyFromEnv(env) {
  const raw = env.CLERK_JWT_KEY;
  if (!raw || !String(raw).trim()) return undefined;
  return String(raw).replace(/\\n/g, '\n');
}

async function loadOwnerUser(env, userId) {
  const clerk = createClerkClient({
    secretKey: env.CLERK_SECRET_KEY,
    publishableKey: env.CLERK_PUBLISHABLE_KEY,
    jwtKey: jwtKeyFromEnv(env),
  });
  return clerk.users.getUser(userId);
}

export async function requireOwner(env, data, request) {
  let user;
  try {
    user = await loadOwnerUser(env, data.userId);
  } catch (err) {
    console.error('Clerk getUser failed', err);
    return { error: json({ error: 'Forbidden' }, 403, request, env) };
  }
  if (!isSiteOwner(user, env)) {
    return { error: json({ error: 'Forbidden' }, 403, request, env) };
  }
  return { user };
}
