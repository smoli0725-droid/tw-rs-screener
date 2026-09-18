window.RS_TEACHING = (() => {
  const SEED_URL = './content/lessons.json';
  const MAX_TITLE = 80;
  const MAX_BODY = 8000;

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

  function normalizeLesson(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const id = String(raw.id || '').trim();
    const title = String(raw.title || '').trim();
    const body = String(raw.body || raw.passage || '').trim();
    if (!id || !title || !body) return null;
    const published = String(raw.published_at || raw.date || '').slice(0, 10);
    return { id, title, body, published_at: published };
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

  function renderList() {
    renderOwnerBar();
    const el = $('#teachingList');
    if (!el) return;
    if (!lessons.length) {
      el.innerHTML = '<div class="empty">尚無教學文章</div>';
      return;
    }
    el.innerHTML = lessons
      .map(
        (lesson) => `<article class="post" data-lesson-id="${esc(lesson.id)}" role="button" tabindex="0">
        <h2 class="post-title">${esc(lesson.title)}</h2>
        <div class="post-meta">${esc(lesson.published_at || '')}${lesson.published_at ? ' · ' : ''}閃電選股</div>
        <p class="post-excerpt">${esc(excerpt(lesson.body))}</p>
      </article>`
      )
      .join('');
  }

  function renderDetail(lesson) {
    renderOwnerBar();
    const el = $('#teachingDetail');
    if (!el) return;
    const ownerBtns = isOwner()
      ? `<div class="item-actions teaching-owner-actions">
          <button type="button" class="ghost-btn" data-edit-lesson="${esc(lesson.id)}">編輯</button>
          <button type="button" class="ghost-btn" data-delete-lesson="${esc(lesson.id)}">刪除</button>
        </div>`
      : '';
    el.innerHTML = `<article class="post post-detail">
      <h2 class="post-title">${esc(lesson.title)}</h2>
      <div class="post-meta">${esc(lesson.published_at || '')}${lesson.published_at ? ' · ' : ''}閃電選股</div>
      <p class="post-body">${esc(lesson.body)}</p>
      ${ownerBtns}
    </article>`;
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
    form.published_at.value = lesson && lesson.published_at ? lesson.published_at : new Date().toISOString().slice(0, 10);
    dialog.showModal();
  }

  function closeEditor() {
    const dialog = $('#lessonDialog');
    if (dialog && dialog.open) dialog.close();
  }

  async function persist(next) {
    if (!window.RS_API || typeof window.RS_API.putLessons !== 'function') {
      throw new Error('no-api');
    }
    const payload = await window.RS_API.putLessons(next);
    if (payload && Array.isArray(payload.lessons)) {
      lessons = normalizeList(payload.lessons);
    } else {
      lessons = next;
    }
    source = 'd1';
    sortLessons();
  }

  async function saveFromForm(form) {
    if (!isOwner()) {
      toast('只有站長可以編輯');
      return;
    }
    const title = String(form.title.value || '').trim();
    const body = String(form.body.value || '').trim();
    const published_at = String(form.published_at.value || '').slice(0, 10);
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
    next.push({ id, title, body, published_at });
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
    const lesson = lessons.find((row) => row.id === id);
    if (!lesson) return;
    pendingDeleteId = id;
    const hint = $('#deleteLessonHint');
    if (hint) hint.textContent = `確定刪除「${lesson.title}」？`;
    const dialog = $('#deleteLessonDialog');
    if (dialog) dialog.showModal();
  }

  async function confirmDelete() {
    if (!pendingDeleteId) return;
    if (!isOwner()) {
      toast('只有站長可以編輯');
      return;
    }
    const next = lessons.filter((row) => row.id !== pendingDeleteId);
    try {
      await persist(next);
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
        const post = e.target.closest('[data-lesson-id]');
        if (!post) return;
        openDetail(post.dataset.lessonId);
      });
      list.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
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
    isOwner,
    getLessons: () => lessons.slice(),
    getSource: () => source,
    getSelectedId: () => selectedId,
  };
})();
