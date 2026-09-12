import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AUTH_JS = fs.readFileSync(path.join(ROOT, 'site/js/auth.js'), 'utf8');

function encodePk(frontendApi) {
  return `pk_test_${Buffer.from(`${frontendApi}$`, 'utf8').toString('base64')}`;
}

function el(id, extras = {}) {
  const attributes = Object.assign({}, extras.attributes);
  const node = {
    id,
    hidden: extras.hidden ?? false,
    innerHTML: '',
    textContent: extras.textContent || '',
    classList: {
      add() {},
      remove() {},
      toggle() {},
    },
    dataset: Object.assign({}, extras.dataset),
    src: extras.src || '',
    async: false,
    crossOrigin: '',
    onload: null,
    onerror: null,
    listeners: { load: [], error: [] },
    attributes,
    getAttribute(name) {
      if (name in attributes) return attributes[name];
      return null;
    },
    setAttribute(name, value) {
      attributes[name] = String(value);
    },
    addEventListener(type, cb) {
      (node.listeners[type] || (node.listeners[type] = [])).push(cb);
    },
    querySelector(sel) {
      if (sel === '[data-setup-msg]') return extras.setupMsg || null;
      return null;
    },
  };
  return node;
}

function makeHarness(opts = {}) {
  const fapi = opts.fapi || 'nearby-starling-2757.clerk.accounts.dev';
  const pk = opts.pk || encodePk(fapi);
  const scripts = [];
  const setupMsg = el('setup-msg');
  const nodes = {
    'auth-loading': el('auth-loading'),
    'auth-setup': el('auth-setup', { hidden: true, setupMsg }),
    'sign-in': el('sign-in', { hidden: true }),
    userButton: el('userButton'),
  };
  const meta = el('meta', {
    attributes: { name: 'clerk-publishable-key', content: opts.metaKey || '' },
  });

  const body = el('body');
  const head = {
    appendChild(script) {
      scripts.push(script);
      queueMicrotask(() => {
        if (opts.networkFail) {
          if (typeof script.onerror === 'function') script.onerror();
          script.listeners.error.forEach((cb) => cb());
          return;
        }
        const supplied =
          script.getAttribute('data-clerk-publishable-key') || context.window.__clerk_publishable_key || '';
        // Mirror clerk.browser.js: empty key → constructor throw → window.Clerk unset; onload still fires.
        if (opts.omitAutoInit) {
          // script downloaded, no instance
        } else if (supplied && !String(supplied).includes('CLERK_PUBLISHABLE_KEY')) {
          context.window.Clerk = opts.clerkInstance || makeClerkInstance();
        }
        if (typeof script.onload === 'function') script.onload();
        script.listeners.load.forEach((cb) => cb());
      });
      return script;
    },
  };

  function querySelector(sel) {
    if (sel === 'meta[name="clerk-publishable-key"]') return meta;
    if (sel.startsWith('#')) return nodes[sel.slice(1)] || null;
    const srcMatch = /^script\[src="(.*)"\]$/.exec(sel);
    if (srcMatch) return scripts.find((s) => s.src === srcMatch[1]) || null;
    if (sel === 'script[data-clerk-publishable-key]') {
      return scripts.find((s) => s.getAttribute('data-clerk-publishable-key')) || null;
    }
    return null;
  }

  const context = {
    window: null,
    document: {
      querySelector,
      createElement(tag) {
        if (tag !== 'script') return el(tag);
        return el('script');
      },
      head,
      body,
    },
    console: { info() {}, error() {} },
    atob: (s) => Buffer.from(s, 'base64').toString('utf8'),
    URL,
    Error,
    Boolean,
    String,
    Promise,
    setTimeout,
    queueMicrotask,
  };
  context.window = context;
  context.globalThis = context;
  context.window.RS_CONFIG = {
    CLERK_PUBLISHABLE_KEY: opts.configKey === undefined ? pk : opts.configKey,
  };
  context.window.addEventListener = () => {};
  context.window.location = { href: 'https://tradingvenator.pages.dev/' };

  vm.runInNewContext(AUTH_JS, context, { filename: 'auth.js' });
  return { context, scripts, setupMsg, pk, fapi, nodes };
}

function makeClerkInstance() {
  const instance = {
    loaded: false,
    user: null,
    isSignedIn: false,
    loadCalls: 0,
    constructed: false,
    async load() {
      instance.loadCalls += 1;
      instance.loaded = true;
    },
    addListener(cb) {
      instance.listener = cb;
      cb({ user: null });
    },
    mountSignIn() {
      instance.mountedSignIn = true;
    },
    mountUserButton() {
      instance.mountedUserButton = true;
    },
  };
  return instance;
}

test('supplies publishable key before clerk.browser.js auto-init', async () => {
  const { context, scripts, pk, fapi } = makeHarness();
  await context.window.RS_AUTH.start();
  assert.equal(context.window.__clerk_publishable_key, pk);
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0].getAttribute('data-clerk-publishable-key'), pk);
  assert.match(scripts[0].src, new RegExp(`https://${fapi}/npm/@clerk/clerk-js@5/dist/clerk.browser.js`));
  assert.equal(scripts[0].crossOrigin, 'anonymous');
});

test('uses pre-constructed window.Clerk instance (not a constructor)', async () => {
  const instance = makeClerkInstance();
  const { context } = makeHarness({ clerkInstance: instance });
  await context.window.RS_AUTH.start();
  assert.equal(context.window.RS_AUTH.clerk, instance);
  assert.equal(instance.loadCalls, 1);
  assert.equal(typeof context.window.Clerk, 'object');
  assert.equal(instance.mountedSignIn, true);
});

test('falls back to meta[name=clerk-publishable-key] when config is placeholder', async () => {
  const fapi = 'meta-source.clerk.accounts.dev';
  const pk = encodePk(fapi);
  const { context, scripts } = makeHarness({
    fapi,
    pk,
    configKey: '__CLERK_PUBLISHABLE_KEY__',
    metaKey: pk,
  });
  await context.window.RS_AUTH.start();
  assert.equal(scripts[0].getAttribute('data-clerk-publishable-key'), pk);
  assert.match(scripts[0].src, /meta-source\.clerk\.accounts\.dev/);
});

test('error message lists failed URLs and does not leak the publishable key', async () => {
  const { context, setupMsg, pk } = makeHarness({ omitAutoInit: true });
  await context.window.RS_AUTH.start();
  const msg = setupMsg.textContent;
  assert.match(msg, /Clerk 載入失敗/);
  assert.match(msg, /jsdelivr\.net/);
  assert.match(msg, /unpkg\.com/);
  assert.match(msg, /window\.Clerk instance missing/);
  assert.equal(msg.includes(pk), false);
});

test('network failures mention the script host without the raw key', async () => {
  const { context, setupMsg, pk, fapi } = makeHarness({ networkFail: true });
  await context.window.RS_AUTH.start();
  const msg = setupMsg.textContent;
  assert.match(msg, new RegExp(fapi));
  assert.match(msg, /Failed to load/);
  assert.equal(msg.includes(pk), false);
});
