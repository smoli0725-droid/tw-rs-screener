window.RS_AUTH = (() => {
  const PLACEHOLDER = '__CLERK_PUBLISHABLE_KEY__';
  let clerk = null;
  let userButtonMounted = false;

  const $ = (sel) => document.querySelector(sel);

  function publishableKey() {
    const fromMeta = document.querySelector('meta[name="clerk-publishable-key"]');
    const metaVal = fromMeta && fromMeta.getAttribute('content');
    const key = (window.RS_CONFIG && window.RS_CONFIG.CLERK_PUBLISHABLE_KEY) || metaVal || '';
    return String(key).trim();
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

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) {
        if (existing.dataset.loaded === '1' || window.Clerk) return resolve();
        existing.addEventListener('load', () => resolve());
        existing.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)));
        return;
      }
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.crossOrigin = 'anonymous';
      script.onload = () => {
        script.dataset.loaded = '1';
        resolve();
      };
      script.onerror = () => reject(new Error(`Failed to load ${src}`));
      document.head.appendChild(script);
    });
  }

  async function loadClerkLibrary(pk) {
    const fapi = frontendApiFromKey(pk);
    const urls = [];
    if (fapi) {
      urls.push(`https://${fapi}/npm/@clerk/clerk-js@5/dist/clerk.browser.js`);
    }
    urls.push('https://cdn.jsdelivr.net/npm/@clerk/clerk-js@5/dist/clerk.browser.js');
    let lastErr;
    for (const url of urls) {
      try {
        await loadScript(url);
        if (window.Clerk) return;
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error('Failed to load Clerk');
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
          colorPrimary: '#0f7a6c',
          colorText: '#0b3d4a',
          colorBackground: '#ffffff',
          borderRadius: '12px',
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
            colorPrimary: '#0f7a6c',
            colorText: '#0b3d4a',
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
      if (typeof window.Clerk === 'function') {
        clerk = new window.Clerk(pk);
      } else {
        clerk = window.Clerk;
      }
      await clerk.load({
        appearance: {
          variables: {
            colorPrimary: '#0f7a6c',
            colorText: '#0b3d4a',
            borderRadius: '12px',
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
      showSetup(`Clerk 載入失敗：${err.message || err}`);
    }
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
  };
})();

window.addEventListener('load', () => {
  window.RS_AUTH.start();
});
