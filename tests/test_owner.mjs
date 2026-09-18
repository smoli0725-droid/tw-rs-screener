import assert from 'node:assert/strict';
import test from 'node:test';

import { emailsFromClerkUser, isSiteOwner, ownerEmailsFromEnv, roleFromClerkUser } from '../functions/_lib/owner.js';

function user(overrides = {}) {
  return {
    primaryEmailAddress: { emailAddress: 'smoli0725@gmail.com' },
    emailAddresses: [{ emailAddress: 'smoli0725@gmail.com' }],
    publicMetadata: {},
    ...overrides,
  };
}

test('defaults owner email when env is empty', () => {
  assert.deepEqual(ownerEmailsFromEnv({}), ['smoli0725@gmail.com']);
  assert.deepEqual(ownerEmailsFromEnv({ OWNER_EMAIL: 'a@x.com, b@y.com' }), ['a@x.com', 'b@y.com']);
});

test('owner email match is case-insensitive', () => {
  assert.equal(isSiteOwner(user({ primaryEmailAddress: { emailAddress: 'SMOLI0725@GMAIL.COM' } }), {}), true);
});

test('non-owner email is rejected', () => {
  assert.equal(
    isSiteOwner(
      user({
        primaryEmailAddress: { emailAddress: 'reader@example.com' },
        emailAddresses: [{ emailAddress: 'reader@example.com' }],
      }),
      {}
    ),
    false
  );
});

test('Clerk publicMetadata.role=owner is enough', () => {
  assert.equal(
    isSiteOwner(
      user({
        primaryEmailAddress: { emailAddress: 'other@example.com' },
        emailAddresses: [],
        publicMetadata: { role: 'owner' },
      }),
      {}
    ),
    true
  );
  assert.equal(roleFromClerkUser({ publicMetadata: { role: 'owner' } }), 'owner');
});

test('OWNER_EMAIL env overrides the default list', () => {
  const guest = user({
    primaryEmailAddress: { emailAddress: 'smoli0725@gmail.com' },
    emailAddresses: [{ emailAddress: 'smoli0725@gmail.com' }],
  });
  assert.equal(isSiteOwner(guest, { OWNER_EMAIL: 'only@example.com' }), false);
  assert.equal(
    isSiteOwner(
      user({
        primaryEmailAddress: { emailAddress: 'only@example.com' },
        emailAddresses: [],
      }),
      { OWNER_EMAIL: 'only@example.com' }
    ),
    true
  );
});

test('collects Clerk email addresses', () => {
  assert.deepEqual(
    emailsFromClerkUser({
      primaryEmailAddress: { emailAddress: 'a@x.com' },
      emailAddresses: [{ emailAddress: 'b@y.com' }],
    }),
    ['a@x.com', 'b@y.com']
  );
});
