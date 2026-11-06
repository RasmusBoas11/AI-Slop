(function () {
  'use strict';

  const cfg = window.BOOKCLUB_CONFIG || {};
  const SHARED = Boolean(cfg.supabaseUrl && cfg.supabaseAnonKey);
  const SUPABASE_SCRIPT = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js';

  // ---------- Small helpers ----------
  const $ = (sel, el = document) => el.querySelector(sel);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  const avg = (nums) => (nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null);
  const fmt = (n) => (n == null ? '–' : n.toFixed(1));
  // A stable colour (0–359) per title or name, for covers and avatars
  const hue = (s) => { let h = 7; for (const c of String(s || '')) h = (h * 31 + c.codePointAt(0)) % 360; return h; };
  const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  const avatarHtml = (name) => `<span class="avatar" style="--h:${hue(name)}" aria-hidden="true">${esc(initials(name))}</span>`;
  const fmtDate = (d) => {
    if (!d) return '';
    const date = new Date(d + 'T00:00:00');
    return isNaN(date) ? d : date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  };

  function readLocal(key, fallback) {
    try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
  }
  function writeLocal(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
  }

  let toastTimer;
  function toast(msg, isError) {
    const el = $('#toast');
    el.textContent = msg;
    el.className = 'toast' + (isError ? ' error' : '');
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, isError ? 5000 : 2500);
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Could not load ' + src));
      document.head.appendChild(s);
    });
  }

  // ---------- Data storage ----------
  // Both stores have the same functions, so the rest of the app
  // doesn't care whether data lives in this browser or in Supabase.

  function localStore() {
    const KEY = 'bookclub-data-v1';
    const load = () => readLocal(KEY, { books: [], ratings: [] });
    const save = (d) => { if (!writeLocal(KEY, d)) throw new Error('Could not save on this device — storage may be full.'); };
    return {
      async listBooks() {
        const d = load();
        return d.books.map((b) => ({ ...b, ratings: d.ratings.filter((r) => r.book_id === b.id) }));
      },
      async addBook(book) {
        const d = load();
        const row = { ...book, id: uid(), created_at: new Date().toISOString() };
        d.books.push(row); save(d); return row;
      },
      async updateBook(id, patch) {
        const d = load();
        const b = d.books.find((x) => x.id === id);
        if (b) Object.assign(b, patch);
        save(d);
      },
      async deleteBook(id) {
        const d = load();
        d.books = d.books.filter((b) => b.id !== id);
        d.ratings = d.ratings.filter((r) => r.book_id !== id);
        save(d);
      },
      async saveRating(r) {
        const d = load();
        const i = d.ratings.findIndex((x) => x.book_id === r.book_id && x.member === r.member);
        if (i >= 0) d.ratings[i] = { ...d.ratings[i], ...r };
        else d.ratings.push({ ...r, id: uid(), created_at: new Date().toISOString() });
        save(d);
      },
      async deleteRating(id) {
        const d = load();
        d.ratings = d.ratings.filter((r) => r.id !== id);
        save(d);
      },
    };
  }

  function supabaseStore() {
    const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
    const check = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
    return {
      async listBooks() { return check(await sb.from('books').select('*, ratings(*)')); },
      async addBook(book) { return check(await sb.from('books').insert(book).select().single()); },
      async updateBook(id, patch) { check(await sb.from('books').update(patch).eq('id', id)); },
      async deleteBook(id) { check(await sb.from('books').delete().eq('id', id)); },
      async saveRating(r) { check(await sb.from('ratings').upsert(r, { onConflict: 'book_id,member' })); },
      async deleteRating(id) { check(await sb.from('ratings').delete().eq('id', id)); },
    };
  }

  // ---------- State ----------
  let store;
  const state = {
    books: [],
    member: readLocal('bookclub-member', ''),
    filter: '',
    sort: readLocal('bookclub-sort', 'recent'),
    openBookId: null,
    editingId: null,
    edit: { cover: '', },
  };

  function scoresOf(book) {
    const rs = book.ratings || [];
    const language = avg(rs.map((r) => r.language));
    const content = avg(rs.map((r) => r.content));
    const overall = language == null ? null : (language + content) / 2;
    return { language, content, overall, count: rs.length };
  }

  async function refresh() {
    try {
      state.books = await store.listBooks();
      renderList();
      if (state.openBookId && $('#bookDialog').open) renderBook();
    } catch (e) {
      toast('Could not load books: ' + e.message, true);
    }
  }

  // ---------- Rendering: list ----------
  function coverHtml(book, cls = '') {
    const style = `style="--h:${hue(book.title)}"`;
    if (book.cover) return `<div class="cover ${cls}" ${style}><img src="${esc(book.cover)}" alt="" loading="lazy" referrerpolicy="no-referrer"></div>`;
    return `<div class="cover ${cls}" ${style}>${esc(book.title || 'No cover')}</div>`;
  }

  function renderOverview() {
    const el = $('#overview');
    const rated = state.books.map((b) => ({ b, s: scoresOf(b) })).filter((x) => x.s.count);
    el.hidden = state.books.length === 0;
    if (el.hidden) return;
    const clubAvg = avg(rated.map((x) => x.s.overall));
    const top = rated.sort((a, b) => b.s.overall - a.s.overall)[0];
    const total = state.books.length;
    el.innerHTML = `
      <div class="stat"><div class="k">Books read</div><div class="v">${total}</div></div>
      <div class="stat"><div class="k">Club average</div><div class="v">${fmt(clubAvg)} <small>/ 5</small></div></div>
      <div class="stat"><div class="k">Top rated</div>${top
        ? `<div class="v title">${esc(top.b.title)}</div><div class="sub">★ ${fmt(top.s.overall)} overall</div>`
        : `<div class="v title">–</div><div class="sub">Score a book to see it here</div>`}</div>`;
  }

  function sortBooks(list) {
    const by = state.sort;
    const nullsLast = (a, b) => (a == null) - (b == null) || (b ?? 0) - (a ?? 0);
    return list.slice().sort((a, b) => {
      if (by === 'title') return (a.title || '').localeCompare(b.title || '');
      if (by === 'read') return (b.read_on || '').localeCompare(a.read_on || '');
      if (by === 'overall' || by === 'language' || by === 'content') {
        return nullsLast(scoresOf(a)[by], scoresOf(b)[by]);
      }
      return (b.created_at || '').localeCompare(a.created_at || '');
    });
  }

  function renderList() {
    const q = state.filter.trim().toLowerCase();
    const list = sortBooks(state.books.filter((b) => !q || `${b.title} ${b.author || ''}`.toLowerCase().includes(q)));

    const grid = $('#grid');
    grid.innerHTML = list.map((b, i) => {
      const s = scoresOf(b);
      const scores = s.count
        ? `<div class="pills">
             <span class="pill" title="Language"><span class="lbl">Lang</span><span class="star">★</span>${fmt(s.language)}</span>
             <span class="pill" title="Content"><span class="lbl">Content</span><span class="star">★</span>${fmt(s.content)}</span>
           </div>`
        : `<p class="unrated">Not scored yet</p>`;
      return `<button class="card" type="button" data-id="${esc(b.id)}" style="--i:${Math.min(i, 12)}">
          ${coverHtml(b)}
          <div class="card-body">
            <h3>${esc(b.title)}</h3>
            ${b.author ? `<p class="author">${esc(b.author)}</p>` : ''}
            ${scores}
          </div>
        </button>`;
    }).join('');

    $('#empty').hidden = state.books.length > 0;
    if (q && !list.length) grid.innerHTML = '<p class="muted">No books in your list match that search.</p>';
    renderOverview();
  }

  // ---------- Rendering: book detail ----------
  function pickerHtml(name, value) {
    return `<div class="picker" data-name="${name}" data-value="${value || 0}" role="radiogroup" aria-label="${name} score">
      ${[1, 2, 3, 4, 5].map((n) => `<button type="button" role="radio" aria-checked="${n === value}" aria-label="${n} of 5" data-v="${n}" class="${n <= (value || 0) ? 'on' : ''}">★</button>`).join('')}
    </div>`;
  }

  function renderBook() {
    const b = state.books.find((x) => x.id === state.openBookId);
    if (!b) { $('#bookDialog').close(); return; }
    const s = scoresOf(b);
    const mine = (b.ratings || []).find((r) => r.member === state.member);
    const others = (b.ratings || []).slice().sort((x, y) => (x.member === state.member ? -1 : y.member === state.member ? 1 : x.member.localeCompare(y.member)));
    const tags = [b.year ? `Published ${b.year}` : '', b.read_on ? `Read ${fmtDate(b.read_on)}` : '', b.added_by ? `Added by ${b.added_by}` : '']
      .filter(Boolean).map((t) => `<span class="tag">${esc(t)}</span>`).join('');
    const avgBox = (v, label, cls = '') => `<div class="avg-box ${cls}"><div class="big-num">${fmt(v)}</div><div class="label">${label}</div><div class="meter" style="--v:${v ?? 0}"><i></i></div></div>`;

    $('#bookBody').innerHTML = `
      <div class="detail-hero" style="--h:${hue(b.title)}">
        <div class="sheet-handle" aria-hidden="true"></div>
        <div class="dialog-head">
          <span></span>
          <button class="icon-btn" type="button" data-close aria-label="Close">✕</button>
        </div>
        <div class="detail-top">
          ${coverHtml(b, 'big')}
          <div class="detail-info">
            <h2>${esc(b.title)}</h2>
            ${b.author ? `<p class="author">${esc(b.author)}</p>` : ''}
            ${tags ? `<div class="tags">${tags}</div>` : ''}
          </div>
        </div>
      </div>
      <div class="averages">
        ${avgBox(s.language, 'Language')}
        ${avgBox(s.content, 'Content')}
        ${avgBox(s.overall, 'Overall', 'main')}
      </div>

      <form class="panel" id="rateForm">
        <h3 class="section-title">${mine ? 'Your score' : 'Give your score'}</h3>
        <div class="rate-row"><span class="label">Language<span class="hint">How well is it written?</span></span>${pickerHtml('language', mine?.language)}</div>
        <div class="rate-row"><span class="label">Content<span class="hint">Story, ideas and characters</span></span>${pickerHtml('content', mine?.content)}</div>
        <textarea id="rateComment" rows="2" maxlength="1000" placeholder="A few words about the book (optional)">${esc(mine?.comment || '')}</textarea>
        <div class="dialog-actions">
          ${mine ? `<button class="btn ghost danger small" type="button" data-action="delete-rating" data-id="${esc(mine.id)}">Remove my score</button>` : ''}
          <button class="btn primary" type="submit">${mine ? 'Update score' : 'Save score'}</button>
        </div>
      </form>

      <div class="panel">
        <h3 class="section-title">Club scores (${s.count})</h3>
        ${s.count ? `<ul class="rating-list">${others.map((r) => `
          <li>
            ${avatarHtml(r.member)}
            <div class="bubble">
              <div class="who">${esc(r.member)}${r.member === state.member ? ' (you)' : ''}
                <span>Language ${esc(r.language)} · Content ${esc(r.content)}</span></div>
              ${r.comment ? `<p>${esc(r.comment)}</p>` : ''}
            </div>
          </li>`).join('')}</ul>` : '<p class="muted">Nobody has scored this book yet. Be the first!</p>'}
      </div>

      ${b.description ? `<details><summary>About the book</summary><p>${esc(b.description)}</p></details>` : ''}

      <div class="dialog-actions">
        <button class="btn ghost danger" type="button" data-action="delete-book">Delete book</button>
        <button class="btn" type="button" data-action="edit-book">Edit book</button>
      </div>`;
  }

  function openBook(id) {
    state.openBookId = id;
    renderBook();
    const d = $('#bookDialog');
    if (!d.open) d.showModal();
    d.scrollTop = 0;
  }

  // ---------- Add / edit book ----------
  function setCover(src) {
    state.edit.cover = src || '';
    $('#coverPreview').innerHTML = src ? `<img src="${esc(src)}" alt="Book cover" referrerpolicy="no-referrer">` : 'No picture';
    $('#coverRemove').hidden = !src;
  }

  function openEdit(book) {
    state.editingId = book ? book.id : null;
    $('#editTitle').textContent = book ? 'Edit book' : 'Add a book';
    $('#searchSection').hidden = Boolean(book);
    $('#searchResults').innerHTML = '';
    $('#searchInput').value = '';
    $('#fTitle').value = book?.title || '';
    $('#fAuthor').value = book?.author || '';
    $('#fYear').value = book?.year || '';
    $('#fReadOn').value = book?.read_on || '';
    $('#fDescription').value = book?.description || '';
    setCover(book?.cover || '');
    $('#editDialog').showModal();
    (book ? $('#fTitle') : $('#searchInput')).focus();
  }

  // Shrink a photo before saving so it loads fast and fits in the database.
  function resizeImage(file, maxW = 400, maxH = 600) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxW / img.width, maxH / img.height);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file is not a picture this browser can read.')); };
      img.src = url;
    });
  }

  // ---------- Search the internet (Open Library + Google Books, both free, no key) ----------
  let lastResults = [];

  async function searchOnline(q) {
    const enc = encodeURIComponent(q);
    const [ol, gb] = await Promise.allSettled([
      fetch(`https://openlibrary.org/search.json?q=${enc}&limit=8&fields=key,title,author_name,first_publish_year,cover_i`).then((r) => r.json()),
      fetch(`https://www.googleapis.com/books/v1/volumes?q=${enc}&maxResults=8&printType=books`).then((r) => r.json()),
    ]);

    const fromOL = ol.status === 'fulfilled' ? (ol.value.docs || []).map((d) => ({
      title: d.title,
      author: (d.author_name || []).slice(0, 2).join(', '),
      year: d.first_publish_year || null,
      cover: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg` : '',
      description: '',
      source: 'Open Library',
    })) : [];

    const fromGB = gb.status === 'fulfilled' ? (gb.value.items || []).map((it) => {
      const v = it.volumeInfo || {};
      const thumb = (v.imageLinks && (v.imageLinks.thumbnail || v.imageLinks.smallThumbnail)) || '';
      return {
        title: v.subtitle ? `${v.title}: ${v.subtitle}` : v.title,
        author: (v.authors || []).slice(0, 2).join(', '),
        year: v.publishedDate ? parseInt(v.publishedDate, 10) || null : null,
        cover: thumb.replace(/^http:/, 'https:').replace('&edge=curl', ''),
        description: v.description || '',
        source: 'Google Books',
      };
    }) : [];

    if (ol.status === 'rejected' && gb.status === 'rejected') throw new Error('Search is not reachable right now. Check your internet connection.');

    // Mix the two sources and drop duplicates.
    const seen = new Set();
    const out = [];
    for (let i = 0; i < Math.max(fromGB.length, fromOL.length); i++) {
      for (const r of [fromGB[i], fromOL[i]]) {
        if (!r || !r.title) continue;
        const key = (r.title + '|' + (r.author.split(',')[0] || '')).toLowerCase().replace(/[^a-z0-9æøåäöü|]/g, '');
        if (seen.has(key)) {
          // Keep the richer one: fill in a missing cover/description
          const prev = out.find((x) => x._key === key);
          if (prev && !prev.cover && r.cover) prev.cover = r.cover;
          if (prev && !prev.description && r.description) prev.description = r.description;
          continue;
        }
        seen.add(key);
        out.push({ ...r, _key: key });
      }
    }
    return out;
  }

  function renderResults(results) {
    lastResults = results;
    $('#searchResults').innerHTML = results.length
      ? results.map((r, i) => `<button class="result" type="button" data-result="${i}" style="--i:${i}">
          ${coverHtml(r)}
          <div><strong>${esc(r.title)}</strong><small>${esc([r.author, r.year].filter(Boolean).join(' · '))}</small></div>
          <span class="src">${esc(r.source)}</span>
        </button>`).join('')
      : '<p class="muted">No books found. Try other words, or fill in the details below.</p>';
  }

  // ---------- Member name ----------
  function askName() {
    $('#nameInput').value = state.member;
    $('#nameDialog').showModal();
  }
  function renderMember() {
    $('#memberBtn').innerHTML = state.member
      ? `${avatarHtml(state.member)}<span class="chip-name">${esc(state.member)}</span>`
      : '<span class="chip-name" style="padding-left:7px">Set name</span>';
  }

  // ---------- Events ----------
  function bindEvents() {
    $('#addBtn').addEventListener('click', () => openEdit(null));
    $('#memberBtn').addEventListener('click', askName);
    $('#filter').addEventListener('input', (e) => { state.filter = e.target.value; renderList(); });
    $('#sort').value = state.sort;
    $('#sort').addEventListener('change', (e) => { state.sort = e.target.value; writeLocal('bookclub-sort', state.sort); renderList(); });

    $('#grid').addEventListener('click', (e) => {
      const card = e.target.closest('.card');
      if (card) openBook(card.dataset.id);
    });
    document.addEventListener('click', (e) => {
      if (e.target.closest('[data-action="add"]')) openEdit(null);
      const closer = e.target.closest('[data-close]');
      if (closer) closer.closest('dialog').close();
    });
    // Close a dialog when tapping the dark area around it
    document.querySelectorAll('dialog').forEach((d) => d.addEventListener('click', (e) => {
      if (e.target === d && d.id !== 'nameDialog') d.close();
    }));

    // Name
    $('#nameDialog').addEventListener('cancel', (e) => { if (!state.member) e.preventDefault(); });
    $('#nameForm').addEventListener('submit', () => {
      const name = $('#nameInput').value.trim();
      if (!name) return;
      state.member = name;
      writeLocal('bookclub-member', name);
      renderMember();
      if ($('#bookDialog').open) renderBook();
    });

    // Book detail: star pickers, save score, edit/delete
    const body = $('#bookBody');
    body.addEventListener('click', async (e) => {
      const star = e.target.closest('.picker button');
      if (star) {
        const picker = star.parentElement;
        const v = Number(star.dataset.v);
        picker.dataset.value = v;
        picker.querySelectorAll('button').forEach((btn) => {
          btn.classList.toggle('on', Number(btn.dataset.v) <= v);
          btn.setAttribute('aria-checked', String(Number(btn.dataset.v) === v));
          btn.classList.remove('pop');
        });
        void star.offsetWidth; // restart the little "pop" animation
        star.classList.add('pop');
        return;
      }
      const action = e.target.closest('[data-action]')?.dataset.action;
      const book = state.books.find((x) => x.id === state.openBookId);
      if (!book) return;
      if (action === 'edit-book') { $('#bookDialog').close(); openEdit(book); }
      if (action === 'delete-book') {
        if (!confirm(`Delete "${book.title}" and all its scores? This cannot be undone.`)) return;
        try { await store.deleteBook(book.id); $('#bookDialog').close(); toast('Book deleted'); await refresh(); }
        catch (err) { toast('Could not delete: ' + err.message, true); }
      }
      if (action === 'delete-rating') {
        try { await store.deleteRating(e.target.closest('[data-id]').dataset.id); toast('Score removed'); await refresh(); }
        catch (err) { toast('Could not remove score: ' + err.message, true); }
      }
    });
    body.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!state.member) { askName(); return; }
      const language = Number($('.picker[data-name="language"]', body).dataset.value);
      const content = Number($('.picker[data-name="content"]', body).dataset.value);
      if (!language || !content) { toast('Pick 1–5 stars for both Language and Content', true); return; }
      const btn = e.target.querySelector('[type="submit"]');
      btn.disabled = true;
      try {
        await store.saveRating({ book_id: state.openBookId, member: state.member, language, content, comment: $('#rateComment').value.trim() || null });
        toast('Score saved');
        await refresh();
      } catch (err) {
        toast('Could not save score: ' + err.message, true);
        btn.disabled = false;
      }
    });

    // Search online
    $('#searchForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const q = $('#searchInput').value.trim();
      if (!q) return;
      $('#searchResults').innerHTML = '<p class="loading"><span class="spinner"></span>Searching the internet…</p>';
      try { renderResults(await searchOnline(q)); }
      catch (err) { $('#searchResults').innerHTML = `<p class="muted">${esc(err.message)}</p>`; }
    });
    $('#searchResults').addEventListener('click', (e) => {
      const el = e.target.closest('[data-result]');
      if (!el) return;
      const r = lastResults[Number(el.dataset.result)];
      $('#fTitle').value = r.title || '';
      $('#fAuthor').value = r.author || '';
      $('#fYear').value = r.year || '';
      $('#fDescription').value = r.description || '';
      setCover(r.cover);
      $('#searchResults').innerHTML = `<p class="muted">✓ Filled in from ${esc(r.source)}. Check the details, add when you read it, then save.</p>`;
      $('#fReadOn').focus();
    });

    // Cover photo
    $('#coverFile').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      try { setCover(await resizeImage(file)); }
      catch (err) { toast(err.message, true); }
    });
    $('#coverRemove').addEventListener('click', () => setCover(''));

    // Save book
    $('#editForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = $('#fTitle').value.trim();
      if (!title) return;
      const yearNum = parseInt($('#fYear').value, 10);
      const data = {
        title,
        author: $('#fAuthor').value.trim() || null,
        year: Number.isFinite(yearNum) ? yearNum : null,
        read_on: $('#fReadOn').value || null,
        description: $('#fDescription').value.trim() || null,
        cover: state.edit.cover || null,
      };
      const btn = $('#saveBook');
      btn.disabled = true;
      try {
        if (state.editingId) {
          await store.updateBook(state.editingId, data);
          toast('Book updated');
          $('#editDialog').close();
          await refresh();
          openBook(state.editingId);
        } else {
          const row = await store.addBook({ ...data, added_by: state.member || null });
          toast('Book added');
          $('#editDialog').close();
          await refresh();
          openBook(row.id);
        }
      } catch (err) {
        toast('Could not save book: ' + err.message, true);
      } finally {
        btn.disabled = false;
      }
    });

    // Pick up other members' changes when coming back to the app
    if (SHARED) {
      document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
    }
  }

  // ---------- Start ----------
  async function init() {
    const name = cfg.clubName || 'Book Club';
    $('#clubName').textContent = name;
    document.title = name;
    renderMember();
    bindEvents();

    if (SHARED) {
      try {
        await loadScript(SUPABASE_SCRIPT);
        store = supabaseStore();
      } catch (e) {
        toast('Could not connect to the shared database. Check your internet connection.', true);
        return;
      }
    } else {
      store = localStore();
      const n = $('#modeNotice');
      n.textContent = 'Books are saved on this device only. To share one list with your club, add your Supabase details to config.js (see README).';
      n.hidden = false;
    }

    await refresh();
    if (!state.member) askName();
  }

  init();
})();
