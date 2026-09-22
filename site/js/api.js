window.RS_API = (() => {
  const base = () => String(window.RS_CONFIG.API_BASE || '').replace(/\/$/, '');

  async function getToken() {
    const clerk = window.RS_AUTH && window.RS_AUTH.clerk;
    const session = clerk && clerk.session;
    if (!session || typeof session.getToken !== 'function') {
      throw new Error('Not signed in');
    }
    const token = await session.getToken();
    if (!token) throw new Error('Not signed in');
    return token;
  }

  async function request(path, opts = {}) {
    const token = await getToken();
    const headers = Object.assign(
      {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      opts.headers || {}
    );
    const isForm =
      typeof FormData !== 'undefined' && opts.body instanceof FormData;
    if (
      opts.body != null &&
      !isForm &&
      !headers['Content-Type'] &&
      !headers['content-type']
    ) {
      headers['Content-Type'] = 'application/json';
    }
    const res = await fetch(`${base()}${path}`, Object.assign({}, opts, { headers }));
    const text = await res.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { error: text };
      }
    }
    if (!res.ok) {
      const msg = (data && data.error) || `${res.status} ${path}`;
      const err = new Error(msg);
      err.status = res.status;
      err.body = data;
      throw err;
    }
    return data;
  }

  return {
    getMe: () => request('/api/me'),
    getData: () => request('/api/data'),
    putData: (payload) =>
      request('/api/data', { method: 'PUT', body: JSON.stringify(payload) }),
    getLessons: () => request('/api/lessons'),
    putLessons: (lessons) =>
      request('/api/lessons', { method: 'PUT', body: JSON.stringify({ lessons }) }),
    deleteLesson: (id) =>
      request(`/api/lessons?id=${encodeURIComponent(id)}`, { method: 'DELETE' }),
    uploadLessonCover: (file) => {
      const body = new FormData();
      body.append('file', file);
      return request('/api/lessons/cover', { method: 'POST', body });
    },
    getPushStatus: () => request('/api/alerts/status'),
    subscribePush: (subscription) =>
      request('/api/alerts/subscribe', { method: 'POST', body: JSON.stringify(subscription) }),
    unsubscribePush: (payload) =>
      request('/api/alerts/unsubscribe', {
        method: 'POST',
        body: JSON.stringify(payload || {}),
      }),
  };
})();
