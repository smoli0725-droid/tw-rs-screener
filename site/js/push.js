window.RS_PUSH = (() => {
  let bound = false;

  const $ = (sel) => document.querySelector(sel);

  function supported() {
    return (
      typeof window !== 'undefined' &&
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      'Notification' in window
    );
  }

  function iosNeedsHomeScreen() {
    const ua = navigator.userAgent || '';
    const ios = /iphone|ipad|ipod/i.test(ua);
    const standalone =
      window.navigator.standalone === true ||
      (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
    return ios && !standalone;
  }

  function setStatus(text) {
    const el = $('#pushStatus');
    if (el) el.textContent = text;
  }

  function setButtons({ enable, disable }) {
    const on = $('#enablePushBtn');
    const off = $('#disablePushBtn');
    if (on) on.hidden = !enable;
    if (off) off.hidden = !disable;
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
    return out;
  }

  function errorText(err) {
    const status = err && err.status;
    if ((err && err.message === 'Not signed in') || status === 401) return '請先登入再開啟推播';
    if (status === 503) return '伺服器尚未設定推播，其他功能不受影響';
    return '無法更新推播，請稍後再試';
  }

  async function localSubscription() {
    if (!supported()) return null;
    const reg = await navigator.serviceWorker.getRegistration('/');
    if (!reg) return null;
    return reg.pushManager.getSubscription();
  }

  async function refresh() {
    if (!$('#pushStatus')) return;
    if (!supported()) {
      setStatus('此瀏覽器不支援推播');
      setButtons({ enable: false, disable: false });
      return;
    }
    if (iosNeedsHomeScreen()) {
      setStatus('iPhone 請先用 Safari「加入主畫面」，再開啟到價推播');
    }
    try {
      const status = await window.RS_API.getPushStatus();
      const local = await localSubscription();
      if (!status.configured || !status.publicKey) {
        setStatus('伺服器尚未設定推播，其他功能不受影響');
        setButtons({ enable: false, disable: false });
        return;
      }
      if (local) {
        const json = local.toJSON();
        try {
          await window.RS_API.subscribePush({
            endpoint: json.endpoint,
            keys: json.keys,
          });
          setStatus('此裝置已開啟到價推播');
          setButtons({ enable: false, disable: true });
        } catch (err) {
          setStatus(errorText(err));
          setButtons({ enable: true, disable: true });
        }
        return;
      }
      if (!iosNeedsHomeScreen()) {
        setStatus(
          status.subscriptionCount > 0
            ? '其他裝置已開啟。此裝置尚未開啟。'
            : '尚未開啟。開啟後，到價時會用瀏覽器通知你。'
        );
      }
      setButtons({ enable: true, disable: status.subscriptionCount > 0 });
    } catch (err) {
      setStatus(errorText(err));
      setButtons({ enable: true, disable: false });
    }
  }

  async function enable() {
    if (!supported()) {
      setStatus('此瀏覽器不支援推播');
      return;
    }
    if (iosNeedsHomeScreen()) {
      setStatus('iPhone 請先用 Safari「加入主畫面」，再開啟到價推播');
      return;
    }
    let status;
    try {
      status = await window.RS_API.getPushStatus();
    } catch (err) {
      setStatus(errorText(err));
      return;
    }
    if (!status.configured || !status.publicKey) {
      setStatus('伺服器尚未設定推播，其他功能不受影響');
      setButtons({ enable: false, disable: false });
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      setStatus('瀏覽器尚未允許通知。請到網站設定打開通知後再試。');
      return;
    }
    try {
      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(status.publicKey),
        });
      }
      const json = sub.toJSON();
      await window.RS_API.subscribePush({
        endpoint: json.endpoint,
        keys: json.keys,
      });
      setStatus('此裝置已開啟到價推播');
      setButtons({ enable: false, disable: true });
      if (window.RS_APP && RS_APP.toast) RS_APP.toast('已開啟到價推播');
    } catch (err) {
      console.error(err);
      setStatus(errorText(err));
    }
  }

  async function disable() {
    try {
      const local = await localSubscription();
      const endpoint = local && local.endpoint;
      if (local) await local.unsubscribe();
      await window.RS_API.unsubscribePush(endpoint ? { endpoint } : {});
      setStatus('已關閉此裝置的到價推播');
      setButtons({ enable: true, disable: false });
      if (window.RS_APP && RS_APP.toast) RS_APP.toast('已關閉到價推播');
    } catch (err) {
      console.error(err);
      setStatus(errorText(err));
    }
  }

  function bind() {
    if (bound) return;
    bound = true;
    const on = $('#enablePushBtn');
    const off = $('#disablePushBtn');
    if (on) on.addEventListener('click', () => enable());
    if (off) off.addEventListener('click', () => disable());
    if (navigator.serviceWorker) {
      navigator.serviceWorker.addEventListener('message', (event) => {
        const data = event.data || {};
        if (data.type !== 'tv-alert') return;
        const title = data.title || '到價通知';
        const body = data.body ? String(data.body).slice(0, 80) : '';
        if (window.RS_APP && RS_APP.toast) {
          RS_APP.toast(body ? `${title}：${body}` : title, 5000);
        }
      });
    }
  }

  return { bind, refresh, enable, disable };
})();
