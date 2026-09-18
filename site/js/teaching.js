window.RS_TEACHING = (() => {
  const SEED_URL = './content/lessons.json';
  const MAX_TITLE = 80;
  const MAX_BODY = 8000;
  const MAX_COVER_URL = 500;

  const $ = (sel, root = document) => root.querySelector(sel);

  let lessons = [];
  let source = 'seed';
  let selectedId = null;
  let bound = false;
  let pendingDeleteId = null;

  function esc(s) {
    return String(s ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');
  }

  function excerpt(text, max = 140) {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    if (t.length <= max) return t;
    return `${t.slice(0, max).replace(/\s+\S*$/, '')}…`;
  }

  function normalizeCoverUrl(raw) {
    const s = String(raw == null ? '' : raw).trim();
    if (!s) return '';
    if (s.length > MAX_COVER_URL) return '';
    if (/[\s<>"'`\\]/.test(s)) return '';
    if (s.startsWith('./') || (s.startsWith('/') && !s.startsWith('//'))) {
      if (s.includes('..') || s.includes('//')) return '';
      if (!/^(\.\/|\/)[A-Za-z0-9._~/-]+$/.test(s)) return '';
      return s;
    }
    try {
      const u = new URL(s);
      if (u.protocol !== 'https:') return '';
      if (u.username || u.password) return '';
      return u.href;
    } catch {
      return '';
    }
  }

  function normalizeLesson(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const id = String(raw.id || '').trim();
    const title = String(raw.title || '').trim();
    const body = String(raw.body || raw.passage || '').trim();
    if (!id || !title || !body) return null;
    const published = String(raw.published_at || raw.date || '').slice(0, 10);
    const cover_url = normalizeCoverUrl(raw.cover_url || raw.image);
    return { id, title, body, published_at: published, cover_url };
  }

  function normalizeList(raw) {
    const arr = Array.isArray(raw) ? raw : Array.isArray(raw?.lessons) ? raw.lessons : [];
    const out = [];
    const seen = new Set();
    for (const item of arr) {
      const lesson = normalizeLesson(item);
      if (!lesson || seen.has(lesson.id)) continue;
      seen.add(lesson.id);
      out.push(lesson);
    }
    return out;
  }

  function sortLessons() {
    lessons.sort((a, b) => String(b.published_at).localeCompare(String(a.published_at)) || String(b.id).localeCompare(String(a.id)));
  }

  function isOwner() {
    return Boolean(window.RS_AUTH && typeof window.RS_AUTH.isOwner === 'function' && window.RS_AUTH.isOwner());
  }

  function toast(msg) {
    if (window.RS_APP && typeof window.RS_APP.toast === 'function') {
      window.RS_APP.toast(msg);
      return;
    }
    console.info(msg);
  }

  async function fetchSeed() {
    const res = await fetch(SEED_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(`${res.status} ${SEED_URL}`);
    return res.json();
  }

  async function fetchCloud() {
    if (!window.RS_API || typeof window.RS_API.getLessons !== 'function') return null;
    const signedIn = window.RS_AUTH && typeof window.RS_AUTH.isSignedIn === 'function' && window.RS_AUTH.isSignedIn();
    if (!signedIn) return null;
    try {
      return await window.RS_API.getLessons();
    } catch {
      return null;
    }
  }

  async function load() {
    let seed = { lessons: [] };
    try {
      seed = await fetchSeed();
    } catch (err) {
      console.error(err);
    }
    const cloud = await fetchCloud();
    if (cloud && cloud.source === 'd1' && Array.isArray(cloud.lessons)) {
      lessons = normalizeList(cloud.lessons);
      source = 'd1';
    } else {
      lessons = normalizeList(seed);
      source = 'seed';
    }
    sortLessons();
    return lessons;
  }

  function listPane() {
    return $('#teachingListPane');
  }

  function detailPane() {
    return $('#teachingDetailPane');
  }

  function syncHash() {
    if (typeof history === 'undefined' || typeof location === 'undefined') return;
    const next = selectedId ? `#teaching/${encodeURIComponent(selectedId)}` : '#teaching';
    if (location.hash === next) return;
    history.replaceState(null, '', `${location.pathname}${location.search}${next}`);
  }

  function showList(opts = {}) {
    selectedId = null;
    const list = listPane();
    const detail = detailPane();
    if (list) list.hidden = false;
    if (detail) detail.hidden = true;
    renderList();
    if (opts.updateHash !== false) syncHash();
  }

  function openDetail(id, opts = {}) {
    const lesson = lessons.find((row) => row.id === id);
    if (!lesson) {
      showList(opts);
      return false;
    }
    selectedId = lesson.id;
    const list = listPane();
    const detail = detailPane();
    if (list) list.hidden = true;
    if (detail) detail.hidden = false;
    renderDetail(lesson);
    if (opts.updateHash !== false) syncHash();
    return true;
  }

  function onViewShown() {
    if (selectedId && lessons.some((row) => row.id === selectedId)) {
      openDetail(selectedId, { updateHash: true });
      return;
    }
    showList({ updateHash: true });
  }

  function openFromHash(hash) {
    const raw = String(hash || '').replace(/^#/, '');
    if (!raw.startsWith('teaching')) return false;
    const rest = raw.slice('teaching'.length).replace(/^\//, '');
    const id = rest ? decodeURIComponent(rest) : '';
    if (id) return openDetail(id, { updateHash: false });
    showList({ updateHash: false });
    return true;
  }

  function renderOwnerBar() {
    const bar = $('#teachingOwnerBar');
    if (!bar) return;
    const owner = isOwner();
    bar.hidden = !owner;
  }

  function coverHtml(lesson, extraClass = '') {
    if (!lesson.cover_url) return '';
    const cls = extraClass ? `post-cover ${extraClass}` : 'post-cover';
    return `<img class="${cls}" src="${esc(lesson.cover_url)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">`;
  }

  function metaHtml(lesson) {
    return `<div class="post-meta">${esc(lesson.published_at || '')}${lesson.published_at ? ' · ' : ''}閃電選股</div>`;
  }

  function renderList() {
    renderOwnerBar();
    const el = $('#teachingList');
    if (!el) return;
    if (!lessons.length) {
      el.innerHTML = '<div class="empty">尚無教學文章</div>';
      return;
    }
    const owner = isOwner();
    el.innerHTML = lessons
      .map((lesson) => {
        const cover = coverHtml(lesson);
        const del = owner
          ? `<button type="button" class="ghost-btn post-delete" data-delete-lesson="${esc(lesson.id)}">刪除</button>`
          : '';
        return `<article class="post${cover ? ' has-cover' : ''}" data-lesson-id="${esc(lesson.id)}" role="button" tabindex="0">
        ${cover}
        <div class="post-copy">
          <h2 class="post-title">${esc(lesson.title)}</h2>
          <p class="post-excerpt">${esc(excerpt(lesson.body))}</p>
          <div class="post-foot">${metaHtml(lesson)}${del}</div>
        </div>
      </article>`;
      })
      .join('');
    bindCoverErrors(el);
  }

  function renderDetail(lesson) {
    renderOwnerBar();
    const el = $('#teachingDetail');
    if (!el) return;
    const cover = coverHtml(lesson, 'post-cover-detail');
    const ownerBtns = isOwner()
      ? `<div class="item-actions teaching-owner-actions">
          <button type="button" class="ghost-btn" data-edit-lesson="${esc(lesson.id)}">編輯</button>
          <button type="button" class="ghost-btn" data-delete-lesson="${esc(lesson.id)}">刪除</button>
        </div>`
      : '';
    el.innerHTML = `<article class="post post-detail${cover ? ' has-cover' : ''}">
      ${cover}
      <div class="post-copy">
        <h2 class="post-title">${esc(lesson.title)}</h2>
        ${metaHtml(lesson)}
        <p class="post-body">${esc(lesson.body)}</p>
        ${ownerBtns}
      </div>
    </article>`;
    bindCoverErrors(el);
  }

  function bindCoverErrors(root) {
    if (!root || typeof root.querySelectorAll !== 'function') return;
    root.querySelectorAll('img.post-cover').forEach((img) => {
      img.addEventListener('error', () => {
        img.hidden = true;
      });
    });
  }

  function render() {
    if (selectedId) openDetail(selectedId, { updateHash: false });
    else renderList();
  }

  function newId() {
    return `p-${Date.now().toString(36)}`;
  }

  function openEditor(lesson) {
    const dialog = $('#lessonDialog');
    const form = $('#lessonForm');
    if (!dialog || !form) return;
    form.reset();
    $('#lessonDialogTitle').textContent = lesson ? '編輯文章' : '新增文章';
    form.id.value = lesson ? lesson.id : '';
    form.title.value = lesson ? lesson.title : '';
    form.body.value = lesson ? lesson.body : '';
    form.cover_url.value = lesson && lesson.cover_url ? lesson.cover_url : '';
    form.published_at.value = lesson && lesson.published_at ? lesson.published_at : new Date().toISOString().slice(0, 10);
    dialog.showModal();
  }

  function closeEditor() {
    const dialog = $('#lessonDialog');
    if (dialog && dialog.open) dialog.close();
  }

  function applySaved(payload, fallback) {
    if (payload && Array.isArray(payload.lessons)) {
      lessons = normalizeList(payload.lessons);
    } else {
      lessons = fallback;
    }
    source = 'd1';
    sortLessons();
  }

  async function persist(next) {
    if (!window.RS_API || typeof window.RS_API.putLessons !== 'function') {
      throw new Error('no-api');
    }
    const payload = await window.RS_API.putLessons(next);
    applySaved(payload, next);
  }

  async function saveFromForm(form) {
    if (!isOwner()) {
      toast('只有站長可以編輯');
      return;
    }
    const title = String(form.title.value || '').trim();
    const body = String(form.body.value || '').trim();
    const published_at = String(form.published_at.value || '').slice(0, 10);
    const coverInput = String(form.cover_url.value || '').trim();
    const cover_url = normalizeCoverUrl(coverInput);
    if (coverInput && !cover_url) {
      toast('封面請貼 https 圖片網址，或網站內路徑');
      return;
    }
    if (!title || !body) {
      toast('請填寫標題與內文');
      return;
    }
    if (title.length > MAX_TITLE || body.length > MAX_BODY) {
      toast('標題或內文過長');
      return;
    }
    const id = String(form.id.value || '').trim() || newId();
    const next = lessons.filter((row) => row.id !== id);
    next.push({ id, title, body, published_at, cover_url });
    try {
      await persist(next);
      closeEditor();
      openDetail(id);
      toast('已儲存');
    } catch (err) {
      console.error(err);
      if (err && err.status === 403) toast('只有站長可以編輯');
      else toast('無法線上儲存，請改 site/content/lessons.json 後部署');
    }
  }

  function openDelete(id) {
    if (!isOwner()) return;
    const lesson = lessons.find((row) => row.id === id);
    if (!lesson) return;
    pendingDeleteId = id;
    const hint = $('#deleteLessonHint');
    if (hint) hint.textContent = `確定刪除「${lesson.title}」？`;
    const dialog = $('#deleteLessonDialog');
    if (dialog) dialog.showModal();
  }

  async function removeLesson(id) {
    const next = lessons.filter((row) => row.id !== id);
    if (window.RS_API && typeof window.RS_API.deleteLesson === 'function') {
      try {
        const payload = await window.RS_API.deleteLesson(id);
        applySaved(payload, next);
        return;
      } catch (err) {
        if (err && (err.status === 403 || err.status === 401)) throw err;
      }
    }
    await persist(next);
  }

  async function confirmDelete() {
    if (!pendingDeleteId) return;
    if (!isOwner()) {
      toast('只有站長可以編輯');
      return;
    }
    const id = pendingDeleteId;
    try {
      await removeLesson(id);
      pendingDeleteId = null;
      const dialog = $('#deleteLessonDialog');
      if (dialog && dialog.open) dialog.close();
      showList();
      toast('已刪除');
    } catch (err) {
      console.error(err);
      if (err && err.status === 403) toast('只有站長可以編輯');
      else toast('無法線上刪除，請改 site/content/lessons.json 後部署');
    }
  }

  function bind() {
    if (bound) return;
    bound = true;
    const list = $('#teachingList');
    if (list) {
      list.addEventListener('click', (e) => {
        const delBtn = e.target.closest('[data-delete-lesson]');
        if (delBtn) {
          e.preventDefault();
          e.stopPropagation();
          openDelete(delBtn.dataset.deleteLesson);
          return;
        }
        const post = e.target.closest('[data-lesson-id]');
        if (!post) return;
        openDetail(post.dataset.lessonId);
      });
      list.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        if (e.target.closest('[data-delete-lesson]')) return;
        const post = e.target.closest('[data-lesson-id]');
        if (!post) return;
        e.preventDefault();
        openDetail(post.dataset.lessonId);
      });
    }
    const addBtn = $('#addLessonBtn');
    if (addBtn) addBtn.addEventListener('click', () => openEditor(null));
    const backBtn = $('#teachingBackBtn');
    if (backBtn) backBtn.addEventListener('click', () => showList());
    const detail = $('#teachingDetail');
    if (detail) {
      detail.addEventListener('click', (e) => {
        const editBtn = e.target.closest('[data-edit-lesson]');
        if (editBtn) {
          const lesson = lessons.find((row) => row.id === editBtn.dataset.editLesson);
          if (lesson) openEditor(lesson);
          return;
        }
        const delBtn = e.target.closest('[data-delete-lesson]');
        if (delBtn) openDelete(delBtn.dataset.deleteLesson);
      });
    }
    const form = $('#lessonForm');
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        saveFromForm(form);
      });
    }
    const cancel = $('#cancelLessonBtn');
    if (cancel) cancel.addEventListener('click', () => closeEditor());
    const cancelDel = $('#cancelDeleteLessonBtn');
    if (cancelDel) {
      cancelDel.addEventListener('click', () => {
        pendingDeleteId = null;
        const dialog = $('#deleteLessonDialog');
        if (dialog && dialog.open) dialog.close();
      });
    }
    const confirmDel = $('#confirmDeleteLessonBtn');
    if (confirmDel) confirmDel.addEventListener('click', () => confirmDelete());
  }

  return {
    load,
    render,
    bind,
    showList,
    openDetail,
    onViewShown,
    openFromHash,
    excerpt,
    normalizeLesson,
    normalizeList,
    normalizeCoverUrl,
    isOwner,
    getLessons: () => lessons.slice(),
    getSource: () => source,
    getSelectedId: () => selectedId,
  };
})();
