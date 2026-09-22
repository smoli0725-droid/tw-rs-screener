window.RS_AUTH = (() => {
  const PLACEHOLDER = '__CLERK_PUBLISHABLE_KEY__';
  let clerk = null;
  let userButtonMounted = false;

  const $ = (sel) => document.querySelector(sel);

  function publishableKey() {
    const fromMeta = document.querySelector('meta[name="clerk-publishable-key"]');
    const metaVal = fromMeta && fromMeta.getAttribute('content');
    const fromConfig = window.RS_CONFIG && window.RS_CONFIG.CLERK_PUBLISHABLE_KEY;
    const candidates = [fromConfig, metaVal];
    for (const raw of candidates) {
      const key = String(raw || '').trim();
      if (isConfigured(key)) return key;
    }
    return String(fromConfig || metaVal || '').trim();
  }

  function isConfigured(key) {
    return Boolean(key) && key !== PLACEHOLDER && !key.includes('CLERK_PUBLISHABLE_KEY');
  }

  function frontendApiFromKey(pk) {
    try {
      const parts = pk.split('_');
      const encoded = parts.slice(2).join('_');
      const decoded = atob(encoded);
      return decoded.replace(/\$+$/, '').replace(/^https?:\/\//, '');
    } catch {
      return '';
    }
  }

  function describeScriptUrl(src) {
    try {
      const u = new URL(src, window.location && window.location.href);
      return `${u.host}${u.pathname}`;
    } catch {
      return 'unknown-url';
    }
  }

  function redactSecrets(text, pk) {
    let out = String(text || '');
    if (pk) out = out.split(pk).join('pk_***');
    return out;
  }

  function isClerkInstance(value) {
    return Boolean(value) && typeof value.load === 'function';
  }

  function supplyPublishableKey(pk) {
    // clerk.browser.js auto-inits with:
    //   script[data-clerk-publishable-key] || window.__clerk_publishable_key
    // Empty key makes the constructor throw and leaves window.Clerk unset.
    window.__clerk_publishable_key = pk;
  }

  function loadScript(src, pk) {
    return new Promise((resolve, reject) => {
      const label = describeScriptUrl(src);
      const fail = () => reject(new Error(`Failed to load ${label}`));
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) {
        existing.setAttribute('data-clerk-publishable-key', pk);
        if (isClerkInstance(window.Clerk) || existing.dataset.loaded === '1') {
          return resolve(label);
        }
        existing.addEventListener('load', () => resolve(label));
        existing.addEventListener('error', fail);
        return;
      }
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.crossOrigin = 'anonymous';
      script.setAttribute('data-clerk-publishable-key', pk);
      script.onload = () => {
        script.dataset.loaded = '1';
        resolve(label);
      };
      script.onerror = fail;
      document.head.appendChild(script);
    });
  }

  function clerkScriptUrls(pk) {
    const fapi = frontendApiFromKey(pk);
    const urls = [];
    if (fapi) {
      urls.push(`https://${fapi}/npm/@clerk/clerk-js@5/dist/clerk.browser.js`);
    }
    urls.push('https://cdn.jsdelivr.net/npm/@clerk/clerk-js@5/dist/clerk.browser.js');
    urls.push('https://unpkg.com/@clerk/clerk-js@5/dist/clerk.browser.js');
    return urls;
  }

  async function loadClerkLibrary(pk) {
    supplyPublishableKey(pk);
    const urls = clerkScriptUrls(pk);
    const failures = [];
    for (const url of urls) {
      const label = describeScriptUrl(url);
      try {
        await loadScript(url, pk);
        if (isClerkInstance(window.Clerk)) return label;
        failures.push(`${label}: loaded but window.Clerk instance missing`);
      } catch (err) {
        failures.push(redactSecrets(err && err.message, pk) || `${label}: failed`);
      }
    }
    throw new Error(`Failed to load Clerk (${failures.join('; ') || 'no script URLs'})`);
  }

  function showSetup(message) {
    const loading = $('#auth-loading');
    const signIn = $('#sign-in');
    const setup = $('#auth-setup');
    if (loading) loading.hidden = true;
    if (signIn) signIn.hidden = true;
    if (setup) {
      setup.hidden = false;
      const msg = setup.querySelector('[data-setup-msg]');
      if (msg && message) msg.textContent = message;
    }
    document.body.classList.add('signed-out');
    document.body.classList.remove('signed-in');
  }

  function setGateVisible(signedIn) {
    document.body.classList.toggle('signed-in', signedIn);
    document.body.classList.toggle('signed-out', !signedIn);
    const loading = $('#auth-loading');
    if (loading) loading.hidden = true;
    const signIn = $('#sign-in');
    const setup = $('#auth-setup');
    if (setup) setup.hidden = true;
    if (signIn) signIn.hidden = signedIn;
  }

  function mountSignIn() {
    const el = $('#sign-in');
    if (!el || !clerk) return;
    el.hidden = false;
    el.innerHTML = '';
    clerk.mountSignIn(el, {
      routing: 'hash',
      appearance: {
        variables: {
          colorPrimary: '#1c1c1c',
          colorText: '#1c1c1c',
          colorBackground: '#fbfaf7',
          borderRadius: '8px',
        },
      },
    });
  }

  function mountUserButton() {
    const el = $('#userButton');
    if (!el || !clerk) return;
    if (!userButtonMounted) {
      clerk.mountUserButton(el, {
        afterSignOutUrl: '/',
        appearance: {
          variables: {
            colorPrimary: '#1c1c1c',
            colorText: '#1c1c1c',
          },
        },
      });
      userButtonMounted = true;
    }
  }

  async function onSignedIn() {
    try {
      const result = await window.RS_STORAGE.hydrateFromCloud();
      if (result && result.migrated) {
        console.info('Migrated localStorage holdings/settings to cloud');
      }
    } catch (err) {
      console.error(err);
      if (window.RS_APP && typeof window.RS_APP.toast === 'function') {
        window.RS_APP.toast('雲端同步失敗，先使用本機快取');
      }
    }
    setGateVisible(true);
    mountUserButton();
    if (window.RS_APP && typeof window.RS_APP.start === 'function') {
      await window.RS_APP.start();
    }
  }

  function onSignedOut() {
    if (window.RS_STORAGE) window.RS_STORAGE.resetCloudFlag();
    setGateVisible(false);
    mountSignIn();
  }

  async function start() {
    const pk = publishableKey();
    if (!isConfigured(pk)) {
      showSetup(
        '尚未設定 Clerk Publishable Key。請在 GitHub Actions secrets 新增 CLERK_PUBLISHABLE_KEY 後重新部署，或本機改 site/js/config.js。'
      );
      return;
    }
    try {
      await loadClerkLibrary(pk);
      // clerk.browser.js constructs window.Clerk during script eval. Do not treat it as a constructor.
      clerk = window.Clerk;
      if (!isClerkInstance(clerk)) {
        throw new Error('Clerk script loaded but window.Clerk instance is missing');
      }
      await clerk.load({
        appearance: {
          variables: {
            colorPrimary: '#1c1c1c',
            colorText: '#1c1c1c',
            borderRadius: '8px',
          },
        },
      });
      let lastSignedIn = null;
      clerk.addListener(({ user }) => {
        const signedIn = Boolean(user);
        if (signedIn === lastSignedIn) return;
        lastSignedIn = signedIn;
        if (signedIn) onSignedIn();
        else onSignedOut();
      });
    } catch (err) {
      console.error(err);
      showSetup(`Clerk 載入失敗：${redactSecrets(err && err.message ? err.message : err, pk)}`);
    }
  }

  function ownerEmails() {
    const cfg = window.RS_CONFIG && window.RS_CONFIG.OWNER_EMAILS;
    const list = Array.isArray(cfg)
      ? cfg
      : String(cfg || '')
          .split(',')
          .map((s) => s.trim());
    return list.map((s) => String(s).toLowerCase().trim()).filter(Boolean);
  }

  function isOwner() {
    const user = clerk && clerk.user;
    if (!user) return false;
    const meta = user.publicMetadata || {};
    const role = String(meta.role || meta.Role || '').toLowerCase();
    if (role === 'owner' || meta.admin === true || meta.isOwner === true) return true;
    const emails = [];
    const primary = user.primaryEmailAddress && user.primaryEmailAddress.emailAddress;
    if (primary) emails.push(primary);
    for (const item of user.emailAddresses || []) {
      if (item && item.emailAddress) emails.push(item.emailAddress);
    }
    const allowed = new Set(ownerEmails());
    return emails.some((email) => allowed.has(String(email).toLowerCase()));
  }

  return {
    start,
    get clerk() {
      return clerk;
    },
    getUser() {
      return clerk && clerk.user;
    },
    isSignedIn() {
      return Boolean(clerk && (clerk.isSignedIn || clerk.user));
    },
    isOwner,
  };
})();

window.addEventListener('load', () => {
  window.RS_AUTH.start();
});
