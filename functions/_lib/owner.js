const DEFAULT_OWNER_EMAILS = ['smoli0725@gmail.com'];

export function ownerEmailsFromEnv(env) {
  const raw = env?.OWNER_EMAIL || '';
  const fromEnv = String(raw)
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return fromEnv.length ? fromEnv : DEFAULT_OWNER_EMAILS.slice();
}

export function emailsFromClerkUser(user) {
  if (!user || typeof user !== 'object') return [];
  const out = [];
  const primary = user.primaryEmailAddress?.emailAddress;
  if (primary) out.push(String(primary));
  for (const item of user.emailAddresses || []) {
    const addr = item && typeof item === 'object' ? item.emailAddress : item;
    if (addr) out.push(String(addr));
  }
  return out;
}

export function roleFromClerkUser(user) {
  if (!user || typeof user !== 'object') return '';
  const meta = user.publicMetadata || user.public_metadata || {};
  if (meta.admin === true || meta.isOwner === true) return 'owner';
  return String(meta.role || meta.Role || '').toLowerCase();
}

export function isSiteOwner(user, env) {
  if (!user) return false;
  if (roleFromClerkUser(user) === 'owner') return true;
  const allowed = new Set(ownerEmailsFromEnv(env));
  return emailsFromClerkUser(user).some((email) => allowed.has(email.toLowerCase()));
}
